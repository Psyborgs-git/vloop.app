import WebSocket from 'isomorphic-ws';
import { decode, encode } from '@msgpack/msgpack';
import { OrchestratorError, ErrorCode } from '@orch/shared';

// `crypto.randomUUID` isn't available in all browser environments (e.g. older WebKit).
// We provide a small fallback to generate RFC‑4122 v4 UUIDs using
// `crypto.getRandomValues` which is widely supported in browsers.
function generateUUID(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // fallback uuid v4
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    // Per RFC-4122 section 4.4, set version bits (0100) and variant bits (10xx)
    buf[6] = ((buf[6] ?? 0) & 0x0f) | 0x40;
    buf[8] = ((buf[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
import { ProcessClient } from './namespaces/process.js';
import { ContainerClient } from './namespaces/container.js';
import { VaultClient } from './namespaces/vault.js';
import { DbClient } from './namespaces/db.js';
import { AgentClient } from './namespaces/agent.js';
import { AuthClient } from './namespaces/auth.js';
import { TerminalClient } from './namespaces/terminal.js';

// Random short ID generator for keepalive pings
// Random short ID generator for keepalive pings
const generateId = () => Math.random().toString(36).substring(2, 15);

export interface ClientConfig {
    url: string;
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
    type: 'response' | 'result' | 'error' | 'stream' | 'event' | 'auth_ok';
}

export interface PayloadMessage extends ServerMessage {
    type: 'response' | 'result';
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
    public readonly auth: AuthClient;
    public readonly terminal: TerminalClient;

    constructor(private config: ClientConfig) {
        this.process = new ProcessClient(this);
        this.container = new ContainerClient(this);
        this.vault = new VaultClient(this);
        this.db = new DbClient(this);
        this.agent = new AgentClient(this);
        this.auth = new AuthClient(this);
        this.terminal = new TerminalClient(this);
        this.config = config;
    }

    public async connect(): Promise<void> {
        // If already open, do nothing
        if (this.ws?.readyState === WebSocket.OPEN) return;
        
        // If already connecting, wait for the existing pending connect
        if (this.ws?.readyState === WebSocket.CONNECTING && this.pendingConnect) {
            return new Promise((resolve, reject) => {
                const original = this.pendingConnect!;
                this.pendingConnect = {
                    resolve: () => {
                        original.resolve();
                        resolve();
                    },
                    reject: (err: Error) => {
                        original.reject(err);
                        reject(err);
                    }
                };
            });
        }

        return new Promise((resolve, reject) => {
            const isBrowser = typeof globalThis !== 'undefined' && typeof (globalThis as any).window !== 'undefined';

            if (isBrowser) {
                // Browser WebSocket doesn't accept the options object
                this.ws = new WebSocket(this.config.url, ['msgpack']);
            } else {
                // Node.js ws accepts the options object for headers and TLS
                this.ws = new WebSocket(this.config.url, ['msgpack'], {
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
                                timestamp: new Date().toISOString()
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
                    } catch {
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

        const id = generateUUID();
        const msg = {
            id,
            type: 'request',
            topic,
            action,
            payload,
            meta: {
                timestamp: new Date().toISOString()
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

        const id = generateUUID();
        const msg = {
            id,
            type: 'request',
            topic,
            action,
            payload,
            meta: {
                timestamp: new Date().toISOString()
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
     * Sends a request and keeps stream handling active after the request resolves.
     * Useful for long-lived feeds where stream frames continue after the initial response.
     */
    public async requestWithPersistentStream<Result = any>(
        topic: string,
        action: string,
        payload: any,
        onStream: (chunk: any) => void,
    ): Promise<{ requestId: string; result: Result }> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('Not connected to Orchestrator');
        }

        const id = generateUUID();
        const msg = {
            id,
            type: 'request',
            topic,
            action,
            payload,
            meta: {
                timestamp: new Date().toISOString(),
            },
        };

        this.setStreamHandler(id, onStream);

        const result = await new Promise<Result>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.pendingRequests.delete(id);
                this.clearStreamHandler(id);
                reject(new Error(`Timeout waiting for response to ${topic}.${action}`));
            }, this.config.timeoutMs ?? 30000);

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

        return { requestId: id, result };
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

            if (msg.type === 'result' || msg.type === 'response') {
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
            } else if (msg.type === 'stream' || msg.type === 'event') {
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
