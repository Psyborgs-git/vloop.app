import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FsServiceWorker } from './service.js';
import type { FsServiceConfig } from './service.js';
import type { RedisLike } from '@orch/event-contracts';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { vi } from 'vitest';

// ─── Mock Redis ─────────────────────────────────────────────────────────────

function createMockRedis(): RedisLike & { _listeners: Map<string, Function[]> } {
    const listeners = new Map<string, Function[]>();
    return {
        _listeners: listeners,
        subscribe: vi.fn().mockResolvedValue(undefined),
        unsubscribe: vi.fn().mockResolvedValue(undefined),
        publish: vi.fn().mockResolvedValue(1),
        on: vi.fn((event: string, cb: Function) => {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event)!.push(cb);
        }),
        hset: vi.fn().mockResolvedValue(1),
        hdel: vi.fn().mockResolvedValue(1),
    };
}

function makeCommand(action: string, payload: Record<string, unknown> = {}) {
    return JSON.stringify({
        traceId: 'tr_test',
        timestamp: new Date().toISOString(),
        userId: 'u_1',
        roles: ['developer'],
        action,
        payload,
        replyTo: 'fs:results:ws_1',
    });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('FsServiceWorker', () => {
    let pub: ReturnType<typeof createMockRedis>;
    let sub: ReturnType<typeof createMockRedis>;
    let store: ReturnType<typeof createMockRedis>;
    let worker: FsServiceWorker;
    let testDir: string;

    beforeEach(async () => {
        pub = createMockRedis();
        sub = createMockRedis();
        store = createMockRedis();
        testDir = mkdtempSync(join(tmpdir(), 'fs-service-test-'));

        // Create test files
        writeFileSync(join(testDir, 'hello.txt'), 'world');
        mkdirSync(join(testDir, 'subdir'));
        writeFileSync(join(testDir, 'subdir', 'nested.txt'), 'nested content');

        const config: FsServiceConfig = {
            redis: { subscriber: sub, publisher: pub, store },
            rootDir: testDir,
        };
        worker = new FsServiceWorker(config);
        await worker.start();
    });

    afterEach(async () => {
        await worker.stop();
        rmSync(testDir, { recursive: true, force: true });
    });

    async function dispatchAndWait(cmdJson: string) {
        const handlers = sub._listeners.get('message') ?? [];
        for (const handler of handlers) {
            handler('fs:ops', cmdJson);
        }
        await new Promise((r) => setTimeout(r, 50));
    }

    it('reads a file', async () => {
        await dispatchAndWait(makeCommand('read', { path: 'hello.txt' }));
        expect(pub.publish).toHaveBeenCalledWith(
            'fs:results:ws_1',
            expect.stringContaining('"content":"world"'),
        );
    });

    it('lists directory contents', async () => {
        await dispatchAndWait(makeCommand('list', { path: '.' }));
        const call = pub.publish.mock.calls.find(
            (c: unknown[]) => typeof c[1] === 'string' && (c[1] as string).includes('"entries"'),
        );
        expect(call).toBeTruthy();
        const result = JSON.parse(call![1] as string);
        const names = result.payload.entries.map((e: { name: string }) => e.name).sort();
        expect(names).toEqual(['hello.txt', 'subdir']);
    });

    it('writes a file', async () => {
        await dispatchAndWait(makeCommand('write', { path: 'new.txt', content: 'hello world' }));
        expect(pub.publish).toHaveBeenCalledWith(
            'fs:results:ws_1',
            expect.stringContaining('"ok":true'),
        );
        const { readFileSync } = await import('node:fs');
        expect(readFileSync(join(testDir, 'new.txt'), 'utf-8')).toBe('hello world');
    });

    it('stats a file', async () => {
        await dispatchAndWait(makeCommand('stat', { path: 'hello.txt' }));
        const call = pub.publish.mock.calls.find(
            (c: unknown[]) => typeof c[1] === 'string' && (c[1] as string).includes('"isFile"'),
        );
        expect(call).toBeTruthy();
        const result = JSON.parse(call![1] as string);
        expect(result.payload.isFile).toBe(true);
        expect(result.payload.size).toBe(5);
    });

    it('creates a directory', async () => {
        await dispatchAndWait(makeCommand('mkdir', { path: 'newdir/deep' }));
        expect(pub.publish).toHaveBeenCalledWith(
            'fs:results:ws_1',
            expect.stringContaining('"ok":true'),
        );
        const { existsSync } = await import('node:fs');
        expect(existsSync(join(testDir, 'newdir', 'deep'))).toBe(true);
    });

    it('removes a file', async () => {
        await dispatchAndWait(makeCommand('remove', { path: 'hello.txt' }));
        expect(pub.publish).toHaveBeenCalledWith(
            'fs:results:ws_1',
            expect.stringContaining('"ok":true'),
        );
        const { existsSync } = await import('node:fs');
        expect(existsSync(join(testDir, 'hello.txt'))).toBe(false);
    });

    it('blocks path traversal', async () => {
        await dispatchAndWait(makeCommand('read', { path: '../../../etc/passwd' }));
        expect(pub.publish).toHaveBeenCalledWith(
            'fs:results:ws_1',
            expect.stringContaining('"status":"error"'),
        );
    });

    it('blocks absolute paths', async () => {
        await dispatchAndWait(makeCommand('read', { path: '/etc/passwd' }));
        expect(pub.publish).toHaveBeenCalledWith(
            'fs:results:ws_1',
            expect.stringContaining('"status":"error"'),
        );
    });

    it('errors on unknown action', async () => {
        await dispatchAndWait(makeCommand('unknown_action', {}));
        expect(pub.publish).toHaveBeenCalledWith(
            'fs:results:ws_1',
            expect.stringContaining('Unknown fs action'),
        );
    });

    it('errors on missing required path', async () => {
        await dispatchAndWait(makeCommand('read', {}));
        expect(pub.publish).toHaveBeenCalledWith(
            'fs:results:ws_1',
            expect.stringContaining('Missing required field'),
        );
    });
});
