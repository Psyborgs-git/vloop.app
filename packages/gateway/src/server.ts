/**
 * Gateway WebSocket server.
 *
 * Implements the 10-step middleware pipeline described in the architecture:
 *
 *   ① TLS Termination   — certs from env (handled by HTTPS config)
 *   ② CORS / Origin      — whitelist of allowed client origins
 *   ③ JWT Verification   — RS256, short-lived tokens
 *   ④ Session Hydration  — load ws:sessions:{connId} from Redis
 *   ⑤ RBAC Check         — match (userId, roles) against {service}:{action}
 *   ⑥ Rate Limiting      — per-user token bucket
 *   ⑦ Event Construction — attach traceId, userId, roles to event
 *   ⑧ Publish to Redis   — PUBLISH {service}:commands {event}
 *   ⑨ Subscribe to reply — SUBSCRIBE {service}:results:{sessionId}
 *   ⑩ Audit Log          — XADD audit:stream {traceId, userId, action, ts}
 */

import { createServer, type Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { RedisClients } from './redis.js';
import { SessionStore } from './session-store.js';
import { ServiceRegistry } from './service-registry.js';
import { EventBridge } from './event-bridge.js';
import { checkPermission, RateLimiter } from './middleware.js';
import type { ServiceName, InboundEvent } from '@orch/event-contracts';
import { SERVICES } from '@orch/event-contracts';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GatewayConfig {
    /** Port to listen on. */
    port: number;
    /** Maximum concurrent WebSocket connections. */
    maxConnections?: number;
    /** Allowed WebSocket origins (empty = allow all). */
    allowedOrigins?: string[];
}

export interface GatewayHandle {
    /** Shut down the gateway gracefully. */
    close(): Promise<void>;
    /** Number of active WebSocket connections. */
    connectionCount(): number;
    /** Service registry for runtime discovery. */
    registry: ServiceRegistry;
}

/** Hook interface for external JWT verification (injected by consumer). */
export interface JwtVerifier {
    /** Verify a token and return userId + roles. Throws on invalid token. */
    verify(token: string): Promise<{ userId: string; roles: string[] }>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateTraceId(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

function isValidService(service: string): service is ServiceName {
    return Object.values(SERVICES).includes(service as ServiceName);
}

// ─── Server Factory ─────────────────────────────────────────────────────────

/**
 * Create and start the gateway WebSocket server.
 *
 * @param config  - Gateway configuration.
 * @param redis   - Pre-connected Redis clients (pub, sub, store).
 * @param jwt     - JWT verification hook.
 * @returns A handle to manage the server lifecycle.
 */
export function createGateway(
    config: GatewayConfig,
    redis: RedisClients,
    jwt: JwtVerifier,
): GatewayHandle {
    const sessions = new SessionStore(redis.store);
    const bridge = new EventBridge(redis.pub, redis.sub);
    const limiter = new RateLimiter();

    // ServiceRegistry is available for health checks and service validation.
    // Exposed via the returned handle for consumers that need runtime discovery.
    const registry = new ServiceRegistry(redis.store);

    const server: Server = createServer((_req, res) => {
        // Health-check endpoint
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
    });

    const wss = new WebSocketServer({
        server,
        maxPayload: 1024 * 1024, // 1 MB
        verifyClient: (info, cb) => {
            // ② Origin check
            if (config.allowedOrigins && config.allowedOrigins.length > 0) {
                const origin = info.origin ?? '';
                if (!config.allowedOrigins.includes(origin)) {
                    cb(false, 403, 'Origin not allowed');
                    return;
                }
            }
            // ① Max connections
            if (config.maxConnections && wss.clients.size >= config.maxConnections) {
                cb(false, 503, 'Connection limit exceeded');
                return;
            }
            cb(true);
        },
    });

    wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
        const connectionId = generateTraceId();

        ws.on('message', async (rawData: Buffer | string) => {
            let data: unknown;
            try {
                data = JSON.parse(typeof rawData === 'string' ? rawData : rawData.toString('utf-8'));
            } catch {
                ws.send(JSON.stringify({ error: 'MALFORMED_MESSAGE', message: 'Invalid JSON' }));
                return;
            }

            // ③ JWT Verification — extract token from the message or initial auth
            const token = extractToken(data, req);
            if (!token) {
                ws.send(JSON.stringify({ error: 'AUTH_REQUIRED', message: 'No token provided' }));
                return;
            }

            let userId: string;
            let roles: string[];

            try {
                const identity = await jwt.verify(token);
                userId = identity.userId;
                roles = identity.roles;
            } catch {
                ws.send(JSON.stringify({ error: 'AUTH_FAILED', message: 'Invalid token' }));
                return;
            }

            // ④ Session Hydration — store/update session in Redis
            await sessions.set(connectionId, {
                userId,
                roles,
                connectedAt: new Date().toISOString(),
            });

            // Validate inbound event structure
            let inbound: InboundEvent;
            try {
                inbound = bridge.validateInbound(data);
            } catch {
                ws.send(JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Invalid event schema' }));
                return;
            }

            // Validate target service exists
            if (!isValidService(inbound.service)) {
                ws.send(JSON.stringify({ error: 'UNKNOWN_SERVICE', message: `Unknown service: ${inbound.service}` }));
                return;
            }

            // ⑤ RBAC Check
            if (!checkPermission(roles, inbound.service, inbound.action)) {
                ws.send(JSON.stringify({
                    error: 'PERMISSION_DENIED',
                    message: `Permission denied: ${inbound.service}:${inbound.action}`,
                }));
                return;
            }

            // ⑥ Rate Limiting
            if (!limiter.consume(userId)) {
                ws.send(JSON.stringify({ error: 'RATE_LIMITED', message: 'Too many requests' }));
                return;
            }

            // ⑦ Event Construction
            const command = bridge.buildCommand(
                { ...inbound, traceId: inbound.traceId || generateTraceId() },
                { userId, roles, connectedAt: new Date().toISOString() },
            );

            // ⑨ Subscribe to reply channel (before publishing to avoid race)
            await bridge.subscribeResults(inbound.service, inbound.sessionId, (_sid, result) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(result));
                }
                if (result.done) {
                    bridge.unsubscribeResults(inbound.service, inbound.sessionId).catch(() => {});
                }
            });

            // ⑧ Publish to Redis
            await bridge.publishCommand(inbound.service as ServiceName, command);

            // ⑩ Audit Log
            await bridge.audit({
                traceId: command.traceId,
                userId,
                action: inbound.action,
                service: inbound.service,
                step: 'published',
                timestamp: new Date().toISOString(),
            });
        });

        ws.on('close', async () => {
            await sessions.delete(connectionId);
        });

        ws.on('error', () => {
            // Connection errors are handled by the close event
        });
    });

    server.listen(config.port);

    return {
        registry,
        async close() {
            await bridge.shutdown();
            for (const client of wss.clients) {
                client.terminate();
            }
            wss.close();
            await new Promise<void>((resolve, reject) => {
                server.close((err) => (err ? reject(err) : resolve()));
            });
        },
        connectionCount() {
            return wss.clients.size;
        },
    };
}

// ─── Token Extraction ───────────────────────────────────────────────────────

function extractToken(data: unknown, req: IncomingMessage): string | null {
    // Try Authorization header first
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7);
    }

    // Try token field in message payload
    if (data && typeof data === 'object' && 'token' in data) {
        const token = (data as Record<string, unknown>)['token'];
        if (typeof token === 'string') return token;
    }

    // Try query string (for WebSocket upgrade)
    const url = req.url ?? '';
    const match = /[?&]token=([^&]+)/.exec(url);
    if (match?.[1]) return decodeURIComponent(match[1]);

    return null;
}
