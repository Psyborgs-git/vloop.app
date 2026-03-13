/**
 * Gateway Client — speaks JSON over WebSocket to the event-driven gateway.
 *
 * This is the new-architecture counterpart to OrchestratorClient (which speaks
 * msgpack to the legacy daemon). Both implement the same namespace interfaces
 * so consumer code can switch by swapping the client constructor.
 *
 * Protocol:
 *   Client → Gateway:  JSON { sessionId, service, action, payload, traceId, timestamp, token? }
 *   Gateway → Client:  JSON { traceId, timestamp, status, stream?, payload?, done }
 */

import WebSocket from 'isomorphic-ws';

// ─── UUID helper ────────────────────────────────────────────────────────────

function generateUUID(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    buf[6] = ((buf[6] ?? 0) & 0x0f) | 0x40;
    buf[8] = ((buf[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GatewayClientConfig {
    /** WebSocket URL of the gateway (e.g. ws://localhost:9090). */
    url: string;
    /** JWT token for authentication. */
    token: string;
    /** Request timeout in ms. Default: 30000. */
    timeoutMs?: number;
}

export interface GatewayResult {
    traceId: string;
    timestamp: string;
    status: 'ok' | 'error';
    stream?: string;
    payload?: unknown;
    done: boolean;
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
    onStream?: (chunk: GatewayResult) => void;
}

// ─── Client ─────────────────────────────────────────────────────────────────

export class GatewayClient {
    private ws: WebSocket | null = null;
    private pending = new Map<string, PendingRequest>();
    private sessionId: string;
    private config: GatewayClientConfig;

    constructor(config: GatewayClientConfig) {
        this.config = config;
        this.sessionId = generateUUID();
    }

    async connect(): Promise<void> {
        if (this.ws?.readyState === WebSocket.OPEN) return;

        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.config.url);

            this.ws.addEventListener('open', () => resolve());
            this.ws.addEventListener('error', (event: unknown) => {
                const e = event as { error?: Error };
                reject(e.error ?? new Error('WebSocket error'));
            });

            this.ws.addEventListener('message', (event: unknown) => {
                const msgEvent = event as { data: string | Buffer };
                const raw = typeof msgEvent.data === 'string'
                    ? msgEvent.data
                    : msgEvent.data.toString('utf-8');
                try {
                    const result = JSON.parse(raw) as GatewayResult;
                    this.handleResult(result);
                } catch {
                    // Ignore malformed messages
                }
            });

            this.ws.addEventListener('close', () => {
                for (const [, req] of this.pending) {
                    clearTimeout(req.timeoutId);
                    req.reject(new Error('Connection closed'));
                }
                this.pending.clear();
            });
        });
    }

    async disconnect(): Promise<void> {
        if (!this.ws) return;
        this.ws.close();
        this.ws = null;
    }

    /**
     * Send a request to a service through the gateway and wait for the final result.
     */
    async request<T = unknown>(service: string, action: string, payload: unknown = {}): Promise<T> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('Not connected to gateway');
        }

        const traceId = generateUUID();
        const event = {
            sessionId: this.sessionId,
            service,
            action,
            payload,
            traceId,
            timestamp: new Date().toISOString(),
            token: this.config.token,
        };

        return new Promise<T>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.pending.delete(traceId);
                reject(new Error(`Timeout waiting for ${service}.${action}`));
            }, this.config.timeoutMs ?? 30_000);

            this.pending.set(traceId, {
                resolve: resolve as (v: unknown) => void,
                reject,
                timeoutId,
            });

            this.ws!.send(JSON.stringify(event));
        });
    }

    /**
     * Send a request and yield streaming results as an async generator.
     */
    async *requestStream<T = unknown>(
        service: string,
        action: string,
        payload: unknown = {},
    ): AsyncGenerator<GatewayResult, T, undefined> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('Not connected to gateway');
        }

        const traceId = generateUUID();
        const event = {
            sessionId: this.sessionId,
            service,
            action,
            payload,
            traceId,
            timestamp: new Date().toISOString(),
            token: this.config.token,
        };

        const chunks: GatewayResult[] = [];
        let isDone = false;
        let finalResult: T | undefined;
        let streamError: Error | undefined;
        let resolveWait: (() => void) | undefined;

        const timeoutId = setTimeout(() => {
            this.pending.delete(traceId);
            isDone = true;
            streamError = new Error(`Timeout waiting for ${service}.${action}`);
            if (resolveWait) resolveWait();
        }, this.config.timeoutMs ?? 120_000);

        this.pending.set(traceId, {
            resolve: (value: unknown) => {
                isDone = true;
                finalResult = value as T;
                clearTimeout(timeoutId);
                if (resolveWait) resolveWait();
            },
            reject: (err: Error) => {
                isDone = true;
                streamError = err;
                clearTimeout(timeoutId);
                if (resolveWait) resolveWait();
            },
            timeoutId,
            onStream: (chunk: GatewayResult) => {
                chunks.push(chunk);
                if (resolveWait) resolveWait();
            },
        });

        this.ws.send(JSON.stringify(event));

        while (!isDone || chunks.length > 0) {
            if (chunks.length > 0) {
                yield chunks.shift()!;
            } else if (!isDone) {
                await new Promise<void>((r) => { resolveWait = r; });
                resolveWait = undefined;
            }
        }

        if (streamError) throw streamError;
        return finalResult as T;
    }

    // ─── Internal ───────────────────────────────────────────────────────

    private handleResult(result: GatewayResult): void {
        const pending = this.pending.get(result.traceId);
        if (!pending) return;

        if (result.status === 'error') {
            clearTimeout(pending.timeoutId);
            this.pending.delete(result.traceId);
            const msg = typeof result.payload === 'object' && result.payload !== null
                ? (result.payload as Record<string, unknown>)['error'] ?? 'Unknown error'
                : 'Unknown error';
            pending.reject(new Error(String(msg)));
            return;
        }

        // Streaming chunk (not done yet)
        if (!result.done) {
            pending.onStream?.(result);
            return;
        }

        // Final result
        clearTimeout(pending.timeoutId);
        this.pending.delete(result.traceId);
        pending.resolve(result.payload);
    }
}
