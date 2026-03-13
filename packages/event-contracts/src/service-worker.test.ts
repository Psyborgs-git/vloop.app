import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceWorker } from './service-worker.js';
import type { ServiceWorkerConfig, RedisLike } from './service-worker.js';
import type { ServiceCommand } from './types.js';

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

function makeCommand(overrides: Partial<ServiceCommand> = {}): ServiceCommand {
    return {
        traceId: 'tr_test',
        timestamp: new Date().toISOString(),
        userId: 'u_1',
        roles: ['developer'],
        action: 'exec',
        payload: { cmd: 'ls' },
        replyTo: 'terminal:results:ws_1',
        ...overrides,
    };
}

// ─── Concrete Worker ────────────────────────────────────────────────────────

class TestWorker extends ServiceWorker {
    public received: ServiceCommand[] = [];
    public shouldThrow = false;

    protected async handleCommand(command: ServiceCommand): Promise<void> {
        this.received.push(command);
        if (this.shouldThrow) throw new Error('Handler failed');

        await this.publishResult(command.replyTo, {
            traceId: command.traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: { output: 'done' },
            done: true,
        });
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ServiceWorker', () => {
    let sub: ReturnType<typeof createMockRedis>;
    let pub: ReturnType<typeof createMockRedis>;
    let store: ReturnType<typeof createMockRedis>;
    let worker: TestWorker;

    const config: ServiceWorkerConfig = {
        serviceName: 'terminal',
        commandChannel: 'terminal:commands',
        heartbeatInterval: 60_000,
    };

    beforeEach(() => {
        sub = createMockRedis();
        pub = createMockRedis();
        store = createMockRedis();
        worker = new TestWorker(config, { subscriber: sub, publisher: pub, store });
    });

    it('start subscribes and registers', async () => {
        await worker.start();
        expect(sub.subscribe).toHaveBeenCalledWith('terminal:commands');
        expect(store.hset).toHaveBeenCalledWith(
            'service:registry',
            'terminal',
            expect.stringContaining('"serviceName":"terminal"'),
        );
    });

    it('processes valid commands', async () => {
        await worker.start();

        const cmd = makeCommand();
        const messageHandlers = sub._listeners.get('message') ?? [];
        for (const handler of messageHandlers) {
            handler('terminal:commands', JSON.stringify(cmd));
        }

        // Wait for async processing
        await new Promise((r) => setTimeout(r, 10));

        expect(worker.received).toHaveLength(1);
        expect(worker.received[0]!.action).toBe('exec');
        expect(pub.publish).toHaveBeenCalledWith(
            'terminal:results:ws_1',
            expect.stringContaining('"status":"ok"'),
        );
    });

    it('publishes error when handler throws', async () => {
        worker.shouldThrow = true;
        await worker.start();

        const cmd = makeCommand();
        const messageHandlers = sub._listeners.get('message') ?? [];
        for (const handler of messageHandlers) {
            handler('terminal:commands', JSON.stringify(cmd));
        }

        await new Promise((r) => setTimeout(r, 10));

        expect(pub.publish).toHaveBeenCalledWith(
            'terminal:results:ws_1',
            expect.stringContaining('"status":"error"'),
        );
    });

    it('ignores messages from other channels', async () => {
        await worker.start();

        const messageHandlers = sub._listeners.get('message') ?? [];
        for (const handler of messageHandlers) {
            handler('other:channel', JSON.stringify(makeCommand()));
        }

        await new Promise((r) => setTimeout(r, 10));
        expect(worker.received).toHaveLength(0);
    });

    it('ignores invalid JSON', async () => {
        await worker.start();

        const messageHandlers = sub._listeners.get('message') ?? [];
        for (const handler of messageHandlers) {
            handler('terminal:commands', 'not json');
        }

        await new Promise((r) => setTimeout(r, 10));
        expect(worker.received).toHaveLength(0);
    });

    it('stop unsubscribes and deregisters', async () => {
        await worker.start();
        await worker.stop();
        expect(sub.unsubscribe).toHaveBeenCalledWith('terminal:commands');
        expect(store.hdel).toHaveBeenCalledWith('service:registry', 'terminal');
    });
});
