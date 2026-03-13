import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VaultServiceWorker } from './service.js';
import type { VaultServiceConfig } from './service.js';
import type { RedisLike } from '@orch/event-contracts';

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

// ─── Mock VaultStore ────────────────────────────────────────────────────────

function createMockVaultStore() {
    return {
        create: vi.fn().mockReturnValue({ name: 'db_pass', version: 1 }),
        get: vi.fn().mockReturnValue({ name: 'db_pass', value: 'secret123', version: 1 }),
        update: vi.fn().mockReturnValue({ name: 'db_pass', version: 2 }),
        delete: vi.fn(),
        list: vi.fn().mockReturnValue([
            { name: 'db_pass', version: 1 },
            { name: 'api_key', version: 1 },
        ]),
    };
}

function makeCommand(action: string, payload: Record<string, unknown> = {}) {
    return JSON.stringify({
        traceId: 'tr_vault',
        timestamp: new Date().toISOString(),
        userId: 'u_1',
        roles: ['developer'],
        action,
        payload,
        replyTo: 'vault:results:ws_1',
    });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('VaultServiceWorker', () => {
    let pub: ReturnType<typeof createMockRedis>;
    let sub: ReturnType<typeof createMockRedis>;
    let store: ReturnType<typeof createMockRedis>;
    let vaultStore: ReturnType<typeof createMockVaultStore>;
    let worker: VaultServiceWorker;

    beforeEach(async () => {
        pub = createMockRedis();
        sub = createMockRedis();
        store = createMockRedis();
        vaultStore = createMockVaultStore();

        const config: VaultServiceConfig = {
            redis: { subscriber: sub, publisher: pub, store },
            vaultStore: vaultStore as any,
        };
        worker = new VaultServiceWorker(config);
        await worker.start();
    });

    async function dispatchAndWait(cmdJson: string) {
        const handlers = sub._listeners.get('message') ?? [];
        for (const handler of handlers) {
            handler('vault:ops', cmdJson);
        }
        await new Promise((r) => setTimeout(r, 20));
    }

    it('creates a secret', async () => {
        await dispatchAndWait(makeCommand('secret.create', { name: 'db_pass', value: 'secret123' }));
        expect(vaultStore.create).toHaveBeenCalledWith('db_pass', 'secret123', undefined, 'u_1');
        expect(pub.publish).toHaveBeenCalledWith(
            'vault:results:ws_1',
            expect.stringContaining('"status":"ok"'),
        );
    });

    it('gets a secret', async () => {
        await dispatchAndWait(makeCommand('secret.get', { name: 'db_pass' }));
        expect(vaultStore.get).toHaveBeenCalledWith('db_pass', undefined, { identity: 'u_1', roles: ['developer'] });
    });

    it('updates a secret', async () => {
        await dispatchAndWait(makeCommand('secret.update', { name: 'db_pass', value: 'new_secret' }));
        expect(vaultStore.update).toHaveBeenCalledWith('db_pass', 'new_secret', undefined, { identity: 'u_1', roles: ['developer'] });
    });

    it('deletes a secret', async () => {
        await dispatchAndWait(makeCommand('secret.delete', { name: 'db_pass' }));
        expect(vaultStore.delete).toHaveBeenCalledWith('db_pass', false);
    });

    it('lists secrets', async () => {
        await dispatchAndWait(makeCommand('secret.list', {}));
        expect(vaultStore.list).toHaveBeenCalled();
        expect(pub.publish).toHaveBeenCalledWith(
            'vault:results:ws_1',
            expect.stringContaining('"secrets"'),
        );
    });

    it('errors on unknown action', async () => {
        await dispatchAndWait(makeCommand('secret.unknown', {}));
        expect(pub.publish).toHaveBeenCalledWith(
            'vault:results:ws_1',
            expect.stringContaining('"status":"error"'),
        );
    });

    it('errors when required field missing', async () => {
        await dispatchAndWait(makeCommand('secret.create', { name: 'test' }));
        expect(pub.publish).toHaveBeenCalledWith(
            'vault:results:ws_1',
            expect.stringContaining('"status":"error"'),
        );
    });
});
