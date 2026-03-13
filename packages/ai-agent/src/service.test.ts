import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiServiceWorker } from './service.js';
import type { AiServiceConfig, AgentHandlerFn } from './service.js';
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

function makeCommand(action: string, payload: Record<string, unknown> = {}) {
    return JSON.stringify({
        traceId: 'tr_ai',
        timestamp: new Date().toISOString(),
        userId: 'u_1',
        roles: ['developer'],
        action,
        payload,
        replyTo: 'ai:results:ws_1',
    });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AiServiceWorker', () => {
    let pub: ReturnType<typeof createMockRedis>;
    let sub: ReturnType<typeof createMockRedis>;
    let store: ReturnType<typeof createMockRedis>;
    let mockHandler: AgentHandlerFn;
    let worker: AiServiceWorker;

    beforeEach(async () => {
        pub = createMockRedis();
        sub = createMockRedis();
        store = createMockRedis();
        mockHandler = vi.fn().mockResolvedValue({ answer: 'Hello, world!' });

        const config: AiServiceConfig = {
            redis: { subscriber: sub, publisher: pub, store },
            handler: mockHandler,
        };
        worker = new AiServiceWorker(config);
        await worker.start();
    });

    async function dispatchAndWait(cmdJson: string) {
        const handlers = sub._listeners.get('message') ?? [];
        for (const handler of handlers) {
            handler('ai:requests', cmdJson);
        }
        await new Promise((r) => setTimeout(r, 20));
    }

    it('delegates actions to the handler', async () => {
        await dispatchAndWait(makeCommand('chat.send', { sessionId: 's_1', content: 'hi' }));
        expect(mockHandler).toHaveBeenCalledWith(
            'chat.send',
            { sessionId: 's_1', content: 'hi' },
            expect.objectContaining({ identity: 'u_1', roles: ['developer'] }),
        );
    });

    it('strips "agent." prefix from action', async () => {
        await dispatchAndWait(makeCommand('agent.chat.send', { content: 'hi' }));
        expect(mockHandler).toHaveBeenCalledWith(
            'chat.send',
            expect.anything(),
            expect.anything(),
        );
    });

    it('publishes final result on success', async () => {
        await dispatchAndWait(makeCommand('model.list', {}));
        expect(pub.publish).toHaveBeenCalledWith(
            'ai:results:ws_1',
            expect.stringContaining('"done":true'),
        );
        const result = JSON.parse(pub.publish.mock.calls.at(-1)![1] as string);
        expect(result.payload).toEqual({ answer: 'Hello, world!' });
    });

    it('publishes error when handler throws', async () => {
        (mockHandler as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('LLM unavailable'));
        await dispatchAndWait(makeCommand('chat.send', { content: 'hi' }));
        // The ServiceWorker base class catches and publishes the error
        expect(pub.publish).toHaveBeenCalledWith(
            'ai:results:ws_1',
            expect.stringContaining('"status":"error"'),
        );
    });

    it('passes streaming emit to handler context', async () => {
        (mockHandler as ReturnType<typeof vi.fn>).mockImplementationOnce(async (_action, _payload, ctx) => {
            ctx.emit?.('stream', 'token1');
            ctx.emit?.('stream', 'token2');
            return { done: true };
        });
        await dispatchAndWait(makeCommand('chat.send', { content: 'hi' }));
        // Should have 3 publishes: 2 stream chunks + 1 final
        const publishCalls = pub.publish.mock.calls.filter(
            (c: unknown[]) => c[0] === 'ai:results:ws_1',
        );
        expect(publishCalls.length).toBeGreaterThanOrEqual(3);
    });
});
