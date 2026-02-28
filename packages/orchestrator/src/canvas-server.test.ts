import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvasServer, type CanvasServerHandle } from './canvas-server.js';

async function getFreePort(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    await new Promise<void>((resolve, reject) => {
        server.close((err) => {
            if (err) return reject(err);
            resolve();
        });
    });
    return port;
}

describe('Canvas server', () => {
    let tmpDir = '';
    let handle: CanvasServerHandle | undefined;

    afterEach(async () => {
        if (handle) {
            await handle.close();
            handle = undefined;
        }
        if (tmpDir) {
            await rm(tmpDir, { recursive: true, force: true });
            tmpDir = '';
        }
    });

    it('serves root page, canvas listing, state endpoints, and injects IPC into html canvases', async () => {
        tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vloop-canvas-test-'));
        const canvasId = 'canvas-1';
        const canvasDir = path.join(tmpDir, canvasId);
        await mkdir(canvasDir, { recursive: true });
        await writeFile(
            path.join(canvasDir, 'index.html'),
            '<!doctype html><html><head><title>Canvas</title></head><body><h1>Canvas</h1></body></html>',
            'utf8',
        );

        const now = new Date().toISOString();
        const canvases = [{
            id: canvasId,
            name: 'Demo Canvas',
            description: 'Test canvas',
            content: '{"ok":true}',
            metadata: {},
            owner: 'tester',
            createdAt: now,
            updatedAt: now,
        }];

        const aiConfigStore = {
            listCanvases: vi.fn(() => canvases),
            getCanvas: vi.fn((id: string) => canvases.find((canvas) => canvas.id === id)),
        } as any;

        const logger = {
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
        } as any;

        const port = await getFreePort();
        handle = createCanvasServer(port, '127.0.0.1', logger, aiConfigStore, tmpDir);
        await handle.listen();

        const base = `http://127.0.0.1:${port}`;

        const rootHtml = await (await fetch(`${base}/`)).text();
        expect(rootHtml).toContain('Interactive AI canvases that stay in sync.');

        const canvasesResponse = await fetch(`${base}/canvases`);
        const canvasesJson = await canvasesResponse.json();
        expect(canvasesJson.canvases).toHaveLength(1);
        expect(canvasesJson.canvases[0].id).toBe(canvasId);

        const injectedHtml = await (await fetch(`${base}/${canvasId}/index.html`)).text();
        expect(injectedHtml).toContain('id="canvas-ipc-client"');
        expect(injectedHtml).toContain('window.CanvasState');
        expect(injectedHtml).toContain('window.CanvasUI');
        expect(injectedHtml).toContain('UI_DIALOG_REQUEST');

        const postStateRes = await fetch(`${base}/${canvasId}/state`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ progress: 42 }),
        });
        expect(postStateRes.ok).toBe(true);

        const stateRes = await fetch(`${base}/${canvasId}/state`);
        const stateJson = await stateRes.json();
        expect(stateJson.state).toEqual({ progress: 42 });
    });
});
