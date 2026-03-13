# Event-Driven Architecture

> **Status**: Active migration  
> **Date**: 2026-03-13

## Overview

vloop.app is migrating from a monolithic single-process architecture to an
event-driven design with Redis as the sole inter-service communication layer.

```
                    ┌──────────────┐
                    │   Client     │ (web-ui, CLI, SDK)
                    └──────┬───────┘
                           │ WebSocket (JSON)
                    ┌──────▼───────┐
                    │   Gateway    │ JWT → RBAC → Rate Limit → Event Build
                    └──────┬───────┘
                           │ Redis Pub/Sub
              ┌────────────┼────────────────┐
              │            │                │
       ┌──────▼───┐  ┌────▼────┐    ┌──────▼───┐
       │ Terminal  │  │   AI    │    │  Vault   │  ... more services
       │  Service  │  │ Service │    │ Service  │
       └──────────┘  └─────────┘    └──────────┘
```

## Key Packages

| Package | Purpose |
|---------|---------|
| `@orch/event-contracts` | Shared types, Zod schemas, channel constants, ServiceWorker base class |
| `@orch/gateway` | WebSocket → Redis translation, JWT, RBAC, rate limiting, audit |
| `@orch/rbac` | Deny-wins RBAC policy engine with Redis-backed role store |
| `@orch/fs-service` | Sandboxed filesystem operations over Redis pub/sub |

## Redis Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `terminal:commands` | Gateway → Terminal | Terminal command dispatch |
| `ai:requests` | Gateway → AI | AI chat/inference requests |
| `vault:ops` | Gateway → Vault | Secret CRUD operations |
| `fs:ops` | Gateway → FS | Filesystem operations |
| `{service}:results:{sessionId}` | Service → Gateway | Per-session reply channel |
| `service:registry` | Services → Gateway | Service heartbeat/discovery (HSET) |
| `audit:stream` | Gateway → Redis | Audit log (XADD) |

## RBAC Model

The RBAC engine uses a **deny-wins** model with glob pattern matching:

```typescript
// Role definitions
{
  guest:     { permissions: ['ai:chat'],         deny: ['terminal:*', 'vault:*'] },
  developer: { permissions: ['terminal:*', 'ai:*', 'fs:*'], deny: ['vault:admin'] },
  admin:     { permissions: ['*'],               deny: [] },
}
```

- Deny from **any** assigned role blocks access
- Extension roles (`extension:{id}`) cannot use wildcards
- Roles are hot-reloadable via Redis HSET

## Service Worker Pattern

Every service extends the `ServiceWorker` base class:

```typescript
import { ServiceWorker, CHANNELS } from '@orch/event-contracts';
import type { ServiceCommand } from '@orch/event-contracts';

class MyServiceWorker extends ServiceWorker {
    constructor(redis) {
        super({ serviceName: 'my-service', commandChannel: CHANNELS.MY_SERVICE }, redis);
    }

    protected async handleCommand(command: ServiceCommand): Promise<void> {
        // Process command...
        await this.publishResult(command.replyTo, {
            traceId: command.traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: { result: 'done' },
            done: true,
        });
    }
}
```

The base class handles:
- Redis subscription management
- Service registry heartbeats
- Zod schema validation of incoming commands
- Error result publishing on handler failure

## Gateway Pipeline

Every client message flows through 10 middleware steps:

1. **TLS Termination** — HTTPS/WSS
2. **CORS / Origin** — whitelist check
3. **JWT Verification** — RS256 token validation
4. **Session Hydration** — Redis HSET `ws:sessions:{connId}`
5. **RBAC Check** — deny-wins policy evaluation
6. **Rate Limiting** — per-user token bucket
7. **Event Construction** — attach traceId, userId, roles
8. **Publish to Redis** — `PUBLISH {service}:commands {event}`
9. **Subscribe to Reply** — `SUBSCRIBE {service}:results:{sessionId}`
10. **Audit Log** — `XADD audit:stream`

## Client SDK

Two client modes are available:

| Client | Protocol | Use Case |
|--------|----------|----------|
| `OrchestratorClient` | msgpack over WS | Legacy daemon (existing) |
| `GatewayClient` | JSON over WS | Event-driven gateway (new) |

Both support `request()` and `requestStream()` for RPC and streaming patterns.

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `REDIS_URL` | — | Redis connection URL (enables event-driven mode) |
| `GATEWAY_PORT` | `9090` | Gateway WebSocket port |
| `ORCH_GATEWAY` | — | CLI: gateway URL for event-driven mode |

## Migration Path

The migration is designed for zero-downtime:

1. **Phase 1** (Complete): Gateway + event-contracts packages
2. **Phase 2** (Complete): Service workers for terminal, vault, AI, filesystem
3. **Phase 3** (In Progress): Orchestrator boots gateway alongside legacy daemon
4. **Phase 4** (Planned): Client SDK and web-ui switch to gateway
5. **Phase 5** (Planned): Remove legacy daemon code
