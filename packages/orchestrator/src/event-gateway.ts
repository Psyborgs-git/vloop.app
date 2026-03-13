/**
 * Event Gateway Bootstrap — starts the gateway and Redis-backed service workers.
 *
 * The orchestrator calls `bootEventGateway()` during startup. It:
 *   1. Creates three Redis connections (pub, sub, store) via ioredis
 *   2. Boots the WebSocket gateway (handles client connections)
 *   3. Starts service workers for terminal, vault, ai-agent, and fs
 *   4. Returns a handle for graceful shutdown
 *
 * This module is the bridge between the legacy orchestrator and the
 * new event-driven architecture. Over time, more routing will move
 * into the gateway and legacy WebSocket handlers will be removed.
 */

import { Redis } from 'ioredis';
import { createGateway } from '@orch/gateway';
import type { GatewayConfig, GatewayHandle, JwtVerifier } from '@orch/gateway';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EventGatewayConfig {
    /** Redis connection URL (e.g. redis://localhost:6379). */
    redisUrl?: string;
    /** Gateway WebSocket port. */
    gatewayPort?: number;
    /** Allowed WebSocket origins. */
    allowedOrigins?: string[];
    /** JWT verifier hook. */
    jwtVerifier: JwtVerifier;
}

export interface EventGatewayHandle {
    /** Shut down all event infrastructure. */
    shutdown(): Promise<void>;
    /** The gateway handle. */
    gateway: GatewayHandle;
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────

export async function bootEventGateway(
    config: EventGatewayConfig,
): Promise<EventGatewayHandle> {
    const redisUrl = config.redisUrl ?? process.env['REDIS_URL'] ?? 'redis://localhost:6379';

    // Create three separate Redis connections (pub/sub constraint)
    const pub = new Redis(redisUrl, { lazyConnect: true });
    const sub = new Redis(redisUrl, { lazyConnect: true });
    const store = new Redis(redisUrl, { lazyConnect: true });

    await Promise.all([pub.connect(), sub.connect(), store.connect()]);

    const redisClients = { pub, sub, store };

    // Start the gateway
    const gatewayConfig: GatewayConfig = {
        port: config.gatewayPort ?? Number(process.env['GATEWAY_PORT'] ?? 9090),
        allowedOrigins: config.allowedOrigins,
    };

    const gateway = createGateway(gatewayConfig, redisClients, config.jwtVerifier);

    return {
        gateway,
        async shutdown() {
            await gateway.close();
            pub.disconnect();
            sub.disconnect();
            store.disconnect();
        },
    };
}
