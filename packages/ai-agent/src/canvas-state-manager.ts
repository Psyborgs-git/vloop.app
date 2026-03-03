import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { Logger } from '@orch/daemon';

export interface CanvasStateManagerOptions {
    path?: string;
}

export interface CanvasStateMessage {
    type: string;
    payload: any;
    canvasId: string;
}

interface PendingInputRequest {
    resolve: (value: { confirmed: boolean; value?: string }) => void;
    timeout: NodeJS.Timeout;
}

export class CanvasStateManager {
    private wss: WebSocketServer;
    private logger: Logger;
    private connections = new Map<string, Set<WebSocket>>();
    private canvasStates = new Map<string, any>();
    private pendingInputRequests = new Map<string, PendingInputRequest>();
    private readonly wsPath: string;

    constructor(server: Server, logger: Logger, options: CanvasStateManagerOptions = {}) {
        this.logger = logger;
        this.wsPath = options.path ?? '/';
        this.wss = new WebSocketServer({ server });

        this.wss.on('connection', (ws, req) => {
            const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);

            if (this.wsPath !== '/' && url.pathname !== this.wsPath) {
                ws.close(1008, 'Invalid websocket path');
                return;
            }

            const canvasId = url.searchParams.get('canvasId');

            if (!canvasId) {
                ws.close(1008, 'Canvas ID required');
                return;
            }

            this.addConnection(canvasId, ws);

            if (this.canvasStates.has(canvasId)) {
                ws.send(JSON.stringify({
                    type: 'INIT_STATE',
                    payload: this.canvasStates.get(canvasId)
                }));
            }

            ws.on('message', (message) => {
                this.handleMessage(canvasId, ws, message.toString());
            });

            ws.on('close', () => {
                this.removeConnection(canvasId, ws);
            });

            ws.on('error', (err) => {
                this.logger.error(`WebSocket error for canvas ${canvasId}: ${err.message}`);
                this.removeConnection(canvasId, ws);
            });
        });
    }

    private addConnection(canvasId: string, ws: WebSocket) {
        let set = this.connections.get(canvasId);
        if (!set) {
            set = new Set();
            this.connections.set(canvasId, set);
        }
        set.add(ws);
        this.logger.info(`WebSocket connected for canvas: ${canvasId}`);
    }

    private removeConnection(canvasId: string, ws: WebSocket) {
        const set = this.connections.get(canvasId);
        if (set) {
            set.delete(ws);
            if (set.size === 0) {
                this.connections.delete(canvasId);
            }
        }
    }

    private handleMessage(canvasId: string, sender: WebSocket, data: string) {
        try {
            const parsed = JSON.parse(data) as CanvasStateMessage;

            if (parsed.type === 'UI_DIALOG_RESPONSE') {
                const requestId = parsed?.payload?.requestId;
                if (typeof requestId === 'string') {
                    const pending = this.pendingInputRequests.get(requestId);
                    if (pending) {
                        clearTimeout(pending.timeout);
                        this.pendingInputRequests.delete(requestId);
                        pending.resolve({
                            confirmed: !!parsed?.payload?.confirmed,
                            value: typeof parsed?.payload?.value === 'string' ? parsed.payload.value : undefined,
                        });
                    }
                }
                return;
            }

            if (parsed.type === 'UPDATE_STATE') {
                const currentState = this.canvasStates.get(canvasId) || {};
                const newState = { ...currentState, ...parsed.payload };
                this.canvasStates.set(canvasId, newState);

                this.broadcast(canvasId, {
                    type: 'STATE_UPDATED',
                    payload: newState
                }, sender);
            } else {
                this.broadcast(canvasId, parsed, sender);
            }
        } catch {
            this.logger.error(`Canvas ${canvasId} invalid message: ${data}`);
        }
    }

    public broadcast(canvasId: string, message: any, excludeWs?: WebSocket) {
        const set = this.connections.get(canvasId);
        if (set) {
            const payload = JSON.stringify(message);
            for (const ws of set) {
                if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
                    ws.send(payload);
                }
            }
        }
    }

    public async close(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            for (const socketSet of this.connections.values()) {
                for (const socket of socketSet) {
                    socket.terminate();
                }
            }
            this.connections.clear();

            for (const req of this.pendingInputRequests.values()) {
                clearTimeout(req.timeout);
                req.resolve({ confirmed: false });
            }
            this.pendingInputRequests.clear();

            this.wss.close((err) => {
                if (err) return reject(err);
                resolve();
            });
        });
    }

    public updateState(canvasId: string, partialState: any) {
        const currentState = this.canvasStates.get(canvasId) || {};
        const newState = { ...currentState, ...partialState };
        this.canvasStates.set(canvasId, newState);
        this.broadcast(canvasId, {
            type: 'STATE_UPDATED',
            payload: newState
        });
    }

    public getState(canvasId: string) {
        return this.canvasStates.get(canvasId) || {};
    }

    public pushToast(canvasId: string, payload: { message: string; severity?: 'success' | 'error' | 'warning' | 'info'; durationMs?: number }) {
        this.broadcast(canvasId, {
            type: 'UI_TOAST',
            payload,
            canvasId,
        });
    }

    public requestInput(
        canvasId: string,
        payload: {
            title?: string;
            message: string;
            placeholder?: string;
            defaultValue?: string;
            confirmLabel?: string;
            cancelLabel?: string;
            inputType?: 'text' | 'password' | 'number' | 'email';
            timeoutMs?: number;
        },
    ): Promise<{ confirmed: boolean; value?: string }> {
        const requestId = `${canvasId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const timeoutMs = typeof payload.timeoutMs === 'number' && payload.timeoutMs > 0 ? payload.timeoutMs : 60_000;

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.pendingInputRequests.delete(requestId);
                resolve({ confirmed: false });
            }, timeoutMs);

            this.pendingInputRequests.set(requestId, { resolve, timeout });
            this.broadcast(canvasId, {
                type: 'UI_DIALOG_REQUEST',
                payload: {
                    ...payload,
                    requestId,
                },
                canvasId,
            });
        });
    }
}
