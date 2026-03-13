/**
 * Tests for @orch/gateway — EventBridge
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBridge } from './event-bridge.js';
import type { InboundEvent, SessionInfo } from '@orch/event-contracts';

// ─── Mock Redis ─────────────────────────────────────────────────────────────

function createMockRedis() {
    const listeners = new Map<string, ((...args: string[]) => void)[]>();
    return {
        publish: vi.fn().mockResolvedValue(1),
        subscribe: vi.fn().mockResolvedValue('OK'),
        unsubscribe: vi.fn().mockResolvedValue('OK'),
        xadd: vi.fn().mockResolvedValue('1-0'),
        on: vi.fn((event: string, handler: (...args: string[]) => void) => {
            const existing = listeners.get(event) ?? [];
            existing.push(handler);
            listeners.set(event, existing);
        }),
        // Helper to simulate incoming messages (for testing)
        _emit(event: string, ...args: string[]) {
            const handlers = listeners.get(event) ?? [];
            for (const h of handlers) h(...args);
        },
    };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('EventBridge', () => {
    let pub: ReturnType<typeof createMockRedis>;
    let sub: ReturnType<typeof createMockRedis>;
    let bridge: EventBridge;

    beforeEach(() => {
        pub = createMockRedis();
        sub = createMockRedis();
        bridge = new EventBridge(pub as any, sub as any);
    });

    describe('publishCommand', () => {
        it('should publish a valid command to the correct channel', async () => {
            await bridge.publishCommand('terminal', {
                traceId: 'tr_abc123',
                timestamp: '2026-01-01T00:00:00.000Z',
                userId: 'u_42',
                roles: ['developer'],
                action: 'exec',
                payload: { cmd: 'ls -la' },
                replyTo: 'terminal:results:ws_xyz',
            });

            expect(pub.publish).toHaveBeenCalledOnce();
            expect(pub.publish).toHaveBeenCalledWith(
                'terminal:commands',
                expect.any(String),
            );

            const published = JSON.parse(pub.publish.mock.calls[0]![1] as string);
            expect(published.userId).toBe('u_42');
            expect(published.action).toBe('exec');
        });
    });

    describe('subscribeResults', () => {
        it('should subscribe to the correct result channel', async () => {
            const handler = vi.fn();
            await bridge.subscribeResults('terminal', 'ws_xyz', handler);

            expect(sub.subscribe).toHaveBeenCalledWith('terminal:results:ws_xyz');
        });

        it('should invoke handler when a result message arrives', async () => {
            const handler = vi.fn();
            await bridge.subscribeResults('terminal', 'ws_xyz', handler);

            // Simulate an incoming message on the result channel
            const result = {
                traceId: 'tr_abc123',
                timestamp: '2026-01-01T00:00:00.000Z',
                status: 'ok',
                stream: 'drwxr-xr-x  2 user user 4096',
                done: false,
            };
            sub._emit('message', 'terminal:results:ws_xyz', JSON.stringify(result));

            expect(handler).toHaveBeenCalledWith('ws_xyz', expect.objectContaining({
                status: 'ok',
                stream: 'drwxr-xr-x  2 user user 4096',
                done: false,
            }));
        });
    });

    describe('unsubscribeResults', () => {
        it('should unsubscribe from the result channel', async () => {
            await bridge.unsubscribeResults('terminal', 'ws_xyz');
            expect(sub.unsubscribe).toHaveBeenCalledWith('terminal:results:ws_xyz');
        });
    });

    describe('audit', () => {
        it('should write to the audit stream', async () => {
            await bridge.audit({
                traceId: 'tr_abc123',
                userId: 'u_42',
                action: 'exec',
                service: 'terminal',
                step: 'published',
                timestamp: '2026-01-01T00:00:00.000Z',
            });

            expect(pub.xadd).toHaveBeenCalledWith(
                'audit:stream',
                '*',
                'traceId', 'tr_abc123',
                'userId', 'u_42',
                'action', 'exec',
                'service', 'terminal',
                'step', 'published',
                'timestamp', '2026-01-01T00:00:00.000Z',
            );
        });
    });

    describe('buildCommand', () => {
        it('should build a ServiceCommand from inbound event and session', () => {
            const inbound: InboundEvent = {
                traceId: 'tr_abc123',
                timestamp: '2026-01-01T00:00:00.000Z',
                sessionId: 'ws_xyz',
                service: 'terminal',
                action: 'exec',
                payload: { cmd: 'ls -la' },
            };

            const session: SessionInfo = {
                userId: 'u_42',
                roles: ['developer'],
                connectedAt: '2026-01-01T00:00:00.000Z',
            };

            const command = bridge.buildCommand(inbound, session);

            expect(command.traceId).toBe('tr_abc123');
            expect(command.userId).toBe('u_42');
            expect(command.roles).toEqual(['developer']);
            expect(command.action).toBe('exec');
            expect(command.payload).toEqual({ cmd: 'ls -la' });
            expect(command.replyTo).toBe('terminal:results:ws_xyz');
        });
    });

    describe('validateInbound', () => {
        it('should accept valid inbound data', () => {
            const result = bridge.validateInbound({
                traceId: 'tr_abc123',
                timestamp: '2026-01-01T00:00:00.000Z',
                sessionId: 'ws_xyz',
                service: 'terminal',
                action: 'exec',
                payload: { cmd: 'ls' },
            });

            expect(result.service).toBe('terminal');
            expect(result.action).toBe('exec');
        });

        it('should throw on invalid inbound data', () => {
            expect(() => bridge.validateInbound({})).toThrow();
        });
    });
});
