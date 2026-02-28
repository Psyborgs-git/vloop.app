import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { CanvasStateManager } from './canvas-state-manager.js';

function waitForOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WebSocket open timeout')), 3000);
        ws.once('open', () => {
            clearTimeout(timer);
            resolve();
        });
        ws.once('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

describe('CanvasStateManager', () => {
    const sockets: WebSocket[] = [];
    let server: http.Server | undefined;

    afterEach(async () => {
        for (const socket of sockets.splice(0, sockets.length)) {
            socket.close();
        }
        if (server) {
            await new Promise<void>((resolve, reject) => {
                server?.close((err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
            server = undefined;
        }
    });

    it('broadcasts state updates to peers and stores merged state', async () => {
        server = http.createServer();

        const logger = {
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
        } as any;

        const manager = new CanvasStateManager(server, logger, { path: '/_canvas-ipc' });

        await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
        const port = (server.address() as AddressInfo).port;

        const wsA = new WebSocket(`ws://127.0.0.1:${port}/_canvas-ipc?canvasId=test-canvas`);
        const wsB = new WebSocket(`ws://127.0.0.1:${port}/_canvas-ipc?canvasId=test-canvas`);
        sockets.push(wsA, wsB);

        await Promise.all([waitForOpen(wsA), waitForOpen(wsB)]);

        const gotUpdate = new Promise<any>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('No state update received')), 3000);
            wsB.on('message', (raw) => {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'STATE_UPDATED') {
                    clearTimeout(timer);
                    resolve(msg);
                }
            });
        });

        wsA.send(JSON.stringify({
            type: 'UPDATE_STATE',
            payload: { counter: 1 },
            canvasId: 'test-canvas',
        }));

        const message = await gotUpdate;
        expect(message.payload).toEqual({ counter: 1 });
        expect(manager.getState('test-canvas')).toEqual({ counter: 1 });
    });

    it('rejects websocket connections on invalid path', async () => {
        server = http.createServer();

        const logger = {
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
        } as any;

        // Accept only /_canvas-ipc
        new CanvasStateManager(server, logger, { path: '/_canvas-ipc' });

        await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
        const port = (server.address() as AddressInfo).port;

        const ws = new WebSocket(`ws://127.0.0.1:${port}/wrong?canvasId=test-canvas`);
        sockets.push(ws);

        const closeCode = await new Promise<number>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('No close event received')), 3000);
            ws.once('close', (code) => {
                clearTimeout(timer);
                resolve(code);
            });
            ws.once('error', () => {
                // Error can occur before close in some ws versions; wait for close anyway.
            });
        });

        expect(closeCode).toBe(1008);
    });

    it('requests dialog input from canvas client and resolves response', async () => {
        server = http.createServer();

        const logger = {
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
        } as any;

        const manager = new CanvasStateManager(server, logger, { path: '/_canvas-ipc' });

        await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
        const port = (server.address() as AddressInfo).port;

        const ws = new WebSocket(`ws://127.0.0.1:${port}/_canvas-ipc?canvasId=dialog-canvas`);
        sockets.push(ws);
        await waitForOpen(ws);

        const requestPromise = manager.requestInput('dialog-canvas', {
            title: 'Need value',
            message: 'Type your value',
        });

        const requestMessage = await new Promise<any>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('No dialog request received')), 3000);
            ws.on('message', (raw) => {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'UI_DIALOG_REQUEST') {
                    clearTimeout(timer);
                    resolve(msg);
                }
            });
        });

        ws.send(JSON.stringify({
            type: 'UI_DIALOG_RESPONSE',
            canvasId: 'dialog-canvas',
            payload: {
                requestId: requestMessage.payload.requestId,
                confirmed: true,
                value: 'approved-value',
            },
        }));

        await expect(requestPromise).resolves.toEqual({
            confirmed: true,
            value: 'approved-value',
        });
    });
});
