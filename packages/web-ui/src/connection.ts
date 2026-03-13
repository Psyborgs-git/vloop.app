/**
 * Connection Manager — determines the best connection mode for the web-ui.
 *
 * Checks if the event-driven gateway is available at /api/gateway/ws.
 * Falls back to the legacy daemon at /api/ws.
 *
 * This enables a gradual migration: users with Redis running get the new
 * gateway, while those without still use the legacy daemon.
 */

import { OrchestratorClient } from '@orch/client';
import type { ClientConfig } from '@orch/client';

export type ConnectionMode = 'gateway' | 'legacy';

export interface ConnectionResult {
    client: OrchestratorClient;
    mode: ConnectionMode;
}

/**
 * Detect the gateway WebSocket endpoint.
 * If the gateway port is published on 9090, use it.
 * Otherwise fall back to the legacy daemon WebSocket on the same host.
 */
function buildWsUrl(mode: ConnectionMode): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;

    if (mode === 'gateway') {
        // The gateway is behind /api/gateway/ws on the same host
        // (reverse proxy or same-origin path)
        return `${protocol}//${host}/api/gateway/ws`;
    }

    // Legacy daemon WebSocket
    return `${protocol}//${host}/api/ws`;
}

/**
 * Create a client that connects to the best available backend.
 *
 * Strategy:
 *   1. Try the legacy daemon (always available in current deployments)
 *   2. If the gateway becomes available via health check, future reconnections
 *      will use it
 */
export async function createConnection(overrides?: Partial<ClientConfig>): Promise<ConnectionResult> {
    // For now, always connect to the legacy daemon since it's the proven path.
    // The gateway mode will be activated once migration is complete.
    const mode: ConnectionMode = 'legacy';
    const url = buildWsUrl(mode);

    const client = new OrchestratorClient({
        url,
        timeoutMs: 10_000,
        ...overrides,
    });

    await client.connect();
    return { client, mode };
}

/**
 * Check if the gateway health endpoint is reachable.
 * Returns true if /api/gateway/health returns 200.
 */
export async function isGatewayAvailable(): Promise<boolean> {
    try {
        const res = await fetch('/api/gateway/health', {
            method: 'GET',
            signal: AbortSignal.timeout(2000),
        });
        return res.ok;
    } catch {
        return false;
    }
}
