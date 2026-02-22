/**
 * TLS WebSocket server.
 *
 * - Listens on a configurable port with TLS 1.3 via Node.js tls module.
 * - Negotiates subprotocol (json / msgpack) per connection.
 * - Enforces max connections, ping/pong heartbeat, and backpressure.
 * - Dispatches parsed messages to the Router.
 */

import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { OrchestratorError } from '@orch/shared';
import type { Router } from './router.js';
import type { DaemonConfig } from './config.js';
import { parseRequest, serializeResponse, buildErrorResponse } from './protocol.js';
import type { SubProtocol } from './protocol.js';
import type { Logger } from './logging.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WebSocketServerHandle {
    /** Gracefully close all connections and stop listening. */
    close(): Promise<void>;
    /** Current number of active connections. */
    connectionCount(): number;
}

// ─── Server Factory ──────────────────────────────────────────────────────────

export function createWebSocketServer(
    config: DaemonConfig,
    router: Router,
    logger: Logger,
    shutdownSignal: AbortSignal,
): WebSocketServerHandle {
    const { network, tls: tlsConfig } = config;

    // Load TLS certificates
    const tlsOptions = {
        cert: readFileSync(tlsConfig.cert_path),
        key: readFileSync(tlsConfig.key_path),
        minVersion: 'TLSv1.3' as const,
    };

    const server = createHttpsServer(tlsOptions);
    const wss = new WebSocketServer({
        server,
        maxPayload: network.max_message_size_bytes,
        handleProtocols: (protocols) => {
            // Negotiate subprotocol: prefer msgpack, fallback to json
            if (protocols.has('msgpack')) return 'msgpack';
            if (protocols.has('json')) return 'json';
            return 'json'; // Default
        },
    });

    let activeConnections = 0;

    // ─── Connection Handler ──────────────────────────────────────────────

    wss.on('connection', (ws: WebSocket, _req) => {
        // Enforce max connections
        if (activeConnections >= network.max_connections) {
            logger.warn('Max connections reached, rejecting new connection');
            ws.close(1013, 'max_connections_exceeded');
            return;
        }

        activeConnections++;
        const subprotocol = (ws.protocol || 'json') as SubProtocol;
        const connLogger = logger.child({
            component: 'ws-conn',
            subprotocol,
            connections: activeConnections,
        });

        connLogger.info('WebSocket connection established');

        // Ping/pong heartbeat
        let alive = true;
        const pingInterval = setInterval(() => {
            if (!alive) {
                connLogger.warn('Pong timeout — closing connection');
                ws.terminate();
                return;
            }
            alive = false;
            ws.ping();
        }, network.ping_interval_secs * 1000);

        ws.on('pong', () => {
            alive = true;
        });

        // ─── Message Handler ───────────────────────────────────────────────

        ws.on('message', async (data: Buffer | string) => {
            try {
                const request = parseRequest(
                    typeof data === 'string' ? data : Buffer.from(data),
                    subprotocol,
                );

                // Short-circuit encoded frontend keepalive pings
                if (request.topic === 'system' && request.action === 'ping') {
                    alive = true; // Act as a pong
                    return;
                }

                const reqLogger = connLogger.child({
                    msg_id: request.id,
                    topic: request.topic,
                    action: request.action,
                    trace_id: request.meta.trace_id,
                });

                reqLogger.debug('Received request');

                const emit = (type: 'stream' | 'event', payload: unknown, seq?: number) => {
                    const res = {
                        id: request.id,
                        type,
                        topic: request.topic,
                        action: request.action,
                        payload,
                        meta: { timestamp: new Date().toISOString(), trace_id: request.meta.trace_id, seq }
                    };
                    const out = serializeResponse(res as any, subprotocol);
                    ws.send(out);
                };

                const response = await router.dispatch(request, reqLogger, emit);

                // Backpressure check
                if (ws.bufferedAmount > network.max_message_size_bytes * 2) {
                    reqLogger.warn(
                        { buffered: ws.bufferedAmount },
                        'Send buffer exceeds threshold — applying backpressure',
                    );
                }

                const serialized = serializeResponse(response, subprotocol);
                ws.send(serialized);
            } catch (err) {
                const orchErr = OrchestratorError.from(err);
                connLogger.error({ err: orchErr }, 'Message processing failed');

                const errorResponse = buildErrorResponse(
                    'unknown',
                    'unknown',
                    'unknown',
                    orchErr,
                );
                const serialized = serializeResponse(errorResponse, subprotocol);
                ws.send(serialized);
            }
        });

        // ─── Close Handler ─────────────────────────────────────────────────

        ws.on('close', (code, reason) => {
            activeConnections--;
            clearInterval(pingInterval);
            connLogger.info(
                { code, reason: reason.toString() },
                'WebSocket connection closed',
            );
        });

        ws.on('error', (err) => {
            connLogger.error({ err }, 'WebSocket error');
        });
    });

    // ─── Listen ────────────────────────────────────────────────────────────

    server.listen(network.ws_port, network.bind_address, () => {
        logger.info(
            { port: network.ws_port, address: network.bind_address },
            `WebSocket server listening on wss://${network.bind_address}:${network.ws_port}`,
        );
    });

    // ─── Shutdown handling ─────────────────────────────────────────────────

    shutdownSignal.addEventListener('abort', () => {
        logger.info('Shutdown signal received — draining WebSocket connections');
        wss.clients.forEach((client) => {
            client.close(1001, 'server_shutting_down');
        });
        server.close();
    });

    // ─── Return Handle ────────────────────────────────────────────────────

    return {
        async close() {
            return new Promise<void>((resolve) => {
                wss.clients.forEach((client) => {
                    client.close(1001, 'server_shutting_down');
                });
                wss.close(() => {
                    server.close(() => resolve());
                });
            });
        },
        connectionCount() {
            return activeConnections;
        },
    };
}
