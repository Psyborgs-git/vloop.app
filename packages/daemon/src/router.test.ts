/**
 * Tests for @orch/daemon/router — message dispatch with middleware
 */

import { describe, it, expect, vi } from 'vitest';
import { Router } from './router.js';
import type { Middleware, TopicHandler } from './router.js';
import { createLogger } from './logging.js';

const logger = createLogger('silent' as 'error');

// Silence pino in tests
vi.mock('../logging.js', () => ({
    createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        fatal: vi.fn(),
        child: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            fatal: vi.fn(),
            child: vi.fn().mockReturnThis(),
        }),
    }),
}));

function makeRequest(topic: string, action: string, payload: unknown = {}) {
    return {
        id: 'test-msg-1',
        topic,
        action,
        payload,
        meta: {
            timestamp: new Date().toISOString(),
            trace_id: 'trace-1',
        },
    };
}

describe('Router', () => {
    it('should dispatch to the correct topic handler', async () => {
        const router = new Router(logger);
        const handler: TopicHandler = vi.fn().mockResolvedValue({ pong: true });

        router.register('health', handler);
        const response = await router.dispatch(makeRequest('health', 'check'), logger);

        expect(handler).toHaveBeenCalledWith('check', {}, expect.any(Object));
        expect(response.type).toBe('result');
        expect(response.payload).toEqual({ pong: true });
        expect(response.id).toBe('test-msg-1');
    });

    it('should return UNKNOWN_TOPIC for unregistered topics', async () => {
        const router = new Router(logger);
        const response = await router.dispatch(makeRequest('nonexistent', 'do'), logger);

        expect(response.type).toBe('error');
        expect((response.payload as Record<string, unknown>).code).toBe('UNKNOWN_TOPIC');
    });

    it('should catch handler errors and return error response', async () => {
        const router = new Router(logger);
        router.register('bad', () => {
            throw new Error('handler exploded');
        });

        const response = await router.dispatch(makeRequest('bad', 'crash'), logger);
        expect(response.type).toBe('error');
        expect((response.payload as Record<string, unknown>).code).toBe('INTERNAL_ERROR');
    });

    it('should execute middleware in order', async () => {
        const router = new Router(logger);
        const order: string[] = [];

        const mw1: Middleware = async (ctx, next) => {
            order.push('mw1-before');
            const result = await next();
            order.push('mw1-after');
            return result;
        };

        const mw2: Middleware = async (ctx, next) => {
            order.push('mw2-before');
            const result = await next();
            order.push('mw2-after');
            return result;
        };

        router.use(mw1);
        router.use(mw2);
        router.register('test', () => {
            order.push('handler');
            return { ok: true };
        });

        await router.dispatch(makeRequest('test', 'do'), logger);

        expect(order).toEqual(['mw1-before', 'mw2-before', 'handler', 'mw2-after', 'mw1-after']);
    });

    it('should allow middleware to short-circuit', async () => {
        const router = new Router(logger);
        const handler: TopicHandler = vi.fn().mockResolvedValue({ ok: true });

        const blockingMw: Middleware = async () => {
            // Short-circuit: never call next()
            return {
                id: 'test-msg-1',
                type: 'error' as const,
                topic: 'test',
                action: 'do',
                payload: { code: 'BLOCKED', message: 'Middleware blocked' },
                meta: { timestamp: new Date().toISOString() },
            };
        };

        router.use(blockingMw);
        router.register('test', handler);

        const response = await router.dispatch(makeRequest('test', 'do'), logger);
        expect(handler).not.toHaveBeenCalled();
        expect(response.type).toBe('error');
        expect((response.payload as Record<string, unknown>).code).toBe('BLOCKED');
    });

    it('should list registered topics', () => {
        const router = new Router(logger);
        router.register('vault', () => ({}));
        router.register('health', () => ({}));
        router.register('session', () => ({}));

        expect(router.topics().sort()).toEqual(['health', 'session', 'vault']);
    });
});
