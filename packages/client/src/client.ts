import WebSocket from 'isomorphic-ws';
import { decode, encode } from '@msgpack/msgpack';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import { ProcessClient } from './namespaces/process.js';
import { ContainerClient } from './namespaces/container.js';
import { VaultClient } from './namespaces/vault.js';
import { DbClient } from './namespaces/db.js';
import { AgentClient } from './namespaces/agent.js';

// Random short ID generator for keepalive pings
const generateId = () => Math.random().toString(36).substring(2, 15);

export interface ClientConfig {
    url: string;
    token?: string; // JWT token for auth
    tls?: {
        ca?: Buffer | string;
        cert?: Buffer | string;
        key?: Buffer | string;
    };
    timeoutMs?: number;
}

interface PendingRequest {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeoutId: NodeJS.Timeout;
}

export interface ServerMessage {
    id: string;
    type: 'response' | 'error' | 'stream' | 'auth_ok';
}

export interface PayloadMessage extends ServerMessage {
    type: 'response';
    payload: any;
}

export interface ErrorMessage extends ServerMessage {
    type: 'error';
    payload: {
        code: string;
        message: string;
        details?: any;
    };
}

export interface StreamMessage extends ServerMessage {
    type: 'stream';
    payload: any;
}

export class OrchestratorClient {
    private ws: WebSocket | null = null;
    private pendingRequests = new Map<string, PendingRequest>();
    private streamHandlers = new Map<string, (chunk: any) => void>();
    private pendingConnect: { resolve: () => void, reject: (err: Error) => void } | null = null;
    private keepAliveInterval: any = null;

    // Namespaces
    public readonly process: ProcessClient;
    public readonly container: ContainerClient;
    public readonly vault: VaultClient;
    public readonly db: DbClient;
    public readonly agent: AgentClient;

    constructor(private config: ClientConfig) {
        this.process = new ProcessClient(this);
        this.container = new ContainerClient(this);
        this.vault = new VaultClient(this);
        this.db = new DbClient(this);
        this.agent = new AgentClient(this);
    }

    public async connect(): Promise<void> {
        if (this.ws?.readyState === WebSocket.OPEN) return;

        return new Promise((resolve, reject) => {
            const isBrowser = typeof globalThis !== 'undefined' && typeof (globalThis as any).window !== 'undefined';

            if (isBrowser) {
                // Browser WebSocket doesn't accept the options object
                let wsUrl = this.config.url;
                if (this.config.token) {
                    const urlObj = new URL(wsUrl);
                    urlObj.searchParams.set('token', this.config.token);
                    wsUrl = urlObj.toString();
                }
                this.ws = new WebSocket(wsUrl, ['msgpack']);
            } else {
                // Node.js ws accepts the options object for headers and TLS
                const headers: Record<string, string> = {};
                if (this.config.token) {
                    headers['Authorization'] = `Bearer ${this.config.token}`;
                }
                this.ws = new WebSocket(this.config.url, ['msgpack'], {
                    headers,
                    ca: this.config.tls?.ca,
                    cert: this.config.tls?.cert,
                    key: this.config.tls?.key,
                    rejectUnauthorized: !!this.config.tls?.ca,
                });
            }

            this.pendingConnect = { resolve, reject };

            this.ws.addEventListener('open', () => {
                if (this.pendingConnect) {
                    this.pendingConnect.resolve();
                    this.pendingConnect = null;
                }
                // Start Keep-Alive to prevent Daemon timeout
                this.keepAliveInterval = setInterval(() => {
                    if (this.ws?.readyState === WebSocket.OPEN) {
                        // Send a schema-valid Request envelope for keep-alive
                        // The daemon intercepts topic: 'system', action: 'ping'
                        const pingReq = {
                            id: `ping-${generateId()}`,
                            topic: 'system',
                            action: 'ping',
                            payload: {},
                            meta: {
                                timestamp: new Date().toISOString(),
                                session_id: this.config.token
                            }
                        };
                        this.ws.send(encode(pingReq));
                    }
                }, 10000);
            });

            this.ws.addEventListener('message', async (event: any) => {
                let data = event.data;
                let bufferData: Uint8Array;

                // Handle Browser Blob
                if (typeof Blob !== 'undefined' && data instanceof Blob) {
                    data = await data.arrayBuffer();
                }

                // Convert payload to generic Uint8Array for MsgPack compatibility
                if (data instanceof ArrayBuffer) {
                    bufferData = new Uint8Array(data);
                } else if (typeof data === 'string') {
                    // String payloads usually imply JSON fallback format from daemon
                    try {
                        const parsed = JSON.parse(data);
                        // Forward JSON directly to message router via manual buffer coercion structure
                        // The existing handleMessage expects a msgpack-encoded uint8array, so we will
                        // intercept and parse the JSON string, then pass it down.
                        // Or we can just re-encode it to msgpack format to reuse the same downstream logic.
                        bufferData = encode(parsed);
                    } catch (e) {
                        bufferData = new TextEncoder().encode(data);
                    }
                } else {
                    bufferData = new Uint8Array(data); // Coerce Node.js Buffer
                }

                this.handleMessage(bufferData);
            });

            this.ws.addEventListener('error', (event: any) => {
                if (this.pendingConnect) {
                    this.pendingConnect.reject(event.error || new Error('WebSocket error'));
                    this.pendingConnect = null;
                }
                // Handle ongoing errors...
            });

            this.ws.addEventListener('close', () => {
                if (this.keepAliveInterval) {
                    clearInterval(this.keepAliveInterval);
                    this.keepAliveInterval = null;
                }
                this.rejectAllPending(new Error('WebSocket connection closed'));
            });
        });
    }

    public async disconnect(): Promise<void> {
        if (!this.ws) return;
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
        this.rejectAllPending(new Error('Client initiated disconnect'));
        this.ws.close();
        this.ws = null;
    }

    /**
     * Sends an RPC request over the WebSocket link and waits for a single response payload or error.
     */
    public async request<T = any>(topic: string, action: string, payload: any = {}): Promise<T> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('Not connected to Orchestrator');
        }

        const id = crypto.randomUUID();
        const msg = {
            id,
            type: 'request',
            topic,
            action,
            payload,
            meta: {
                timestamp: new Date().toISOString(),
                ...(this.config.token ? { session_id: this.config.token } : {})
            }
        };

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.pendingRequests.delete(id);
                this.streamHandlers.delete(id); // Clean up stream handlers if timeout
                reject(new Error(`Timeout waiting for response to ${topic}.${action}`));
            }, this.config.timeoutMs ?? 30000);

            this.pendingRequests.set(id, { resolve, reject, timeoutId });

            this.ws!.send(encode(msg), (err: any) => {
                if (err) {
                    clearTimeout(timeoutId);
                    this.pendingRequests.delete(id);
                    reject(err);
                }
            });
        });
    }

    /**
     * Sends an RPC request while yielding intermediate stream chunks as an AsyncGenerator.
     * Useful for capturing real-time events while awaiting the final Result payload.
     */
    public async *requestStream<Chunk = any, Result = any>(topic: string, action: string, payload: any = {}): AsyncGenerator<Chunk, Result, undefined> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('Not connected to Orchestrator');
        }

        const id = crypto.randomUUID();
        const msg = {
            id,
            type: 'request',
            topic,
            action,
            payload,
            meta: {
                timestamp: new Date().toISOString(),
                ...(this.config.token ? { session_id: this.config.token } : {})
            }
        };

        const chunks: Chunk[] = [];
        let isDone = false;
        let finalResult: Result | undefined;
        let streamError: Error | undefined;

        let resolvePromise: (() => void) | undefined;

        this.setStreamHandler(id, (chunk: Chunk) => {
            chunks.push(chunk);
            if (resolvePromise) resolvePromise();
        });

        const reqPromise = new Promise<Result>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.pendingRequests.delete(id);
                this.clearStreamHandler(id);
                reject(new Error(`Timeout waiting for response to ${topic}.${action}`));
            }, this.config.timeoutMs ?? 120000); // 2 mins for streaming

            this.pendingRequests.set(id, { resolve, reject, timeoutId });

            this.ws!.send(encode(msg), (err: any) => {
                if (err) {
                    clearTimeout(timeoutId);
                    this.pendingRequests.delete(id);
                    this.clearStreamHandler(id);
                    reject(err);
                }
            });
        });

        reqPromise.then((res) => {
            isDone = true;
            finalResult = res;
            this.clearStreamHandler(id);
            if (resolvePromise) resolvePromise();
        }).catch((err) => {
            isDone = true;
            streamError = err;
            this.clearStreamHandler(id);
            if (resolvePromise) resolvePromise();
        });

        while (!isDone || chunks.length > 0) {
            if (chunks.length > 0) {
                yield chunks.shift()!;
            } else if (!isDone) {
                await new Promise<void>((r) => { resolvePromise = r; });
                resolvePromise = undefined;
            }
        }

        if (streamError) {
            throw streamError;
        }
        return finalResult as Result;
    }

    /**
     * Registers a steady-state streaming handler for long-lived feeds (e.g. process logs).
     * The initial request is sent using `request()`, but asynchronous stream frames are routed here.
     */
    public setStreamHandler(requestId: string, handler: (chunk: any) => void) {
        this.streamHandlers.set(requestId, handler);
    }

    public clearStreamHandler(requestId: string) {
        this.streamHandlers.delete(requestId);
    }

    private handleMessage(data: Uint8Array) {
        try {
            // Check for unformatted plain text heartbeat response (if any)
            if (data.length > 0 && data[0] === 123) { // 123 is ASCII for '{'
                const text = new TextDecoder().decode(data);
                if (text === '{"type":"pong"}') return;
            }

            const msg = decode(data) as any;

            if (msg.type === 'response') {
                const req = this.pendingRequests.get(msg.id);
                if (req) {
                    clearTimeout(req.timeoutId);
                    this.pendingRequests.delete(msg.id);
                    req.resolve((msg as PayloadMessage).payload);
                }
            } else if (msg.type === 'error') {
                const req = this.pendingRequests.get(msg.id);
                if (req) {
                    clearTimeout(req.timeoutId);
                    this.pendingRequests.delete(msg.id);

                    const errMsg = msg as ErrorMessage;
                    const err = new OrchestratorError(
                        errMsg.payload.code as ErrorCode,
                        errMsg.payload.message,
                        errMsg.payload.details
                    );
                    req.reject(err);
                }
            } else if (msg.type === 'stream') {
                const handler = this.streamHandlers.get(msg.id);
                if (handler) {
                    handler((msg as StreamMessage).payload);
                }
            } else if (msg.type === 'auth_ok') {
                // Handled implicitly during connection currently unless strict mTLS is used
            }
        } catch (err) {
            console.error('Failed to parse incoming WebSocket message', err);
        }
    }

    private rejectAllPending(err: Error) {
        for (const req of this.pendingRequests.values()) {
            clearTimeout(req.timeoutId);
            req.reject(err);
        }
        this.pendingRequests.clear();
        this.streamHandlers.clear();
    }
}
