/**
 * Tests for @orch/event-contracts — Zod schemas
 */

import { describe, it, expect } from 'vitest';
import {
    InboundEventSchema,
    ServiceCommandSchema,
    ServiceResultSchema,
    AuditEntrySchema,
    SessionInfoSchema,
    ServiceRegistryEntrySchema,
} from './schemas.js';

describe('InboundEventSchema', () => {
    it('should accept a valid inbound event', () => {
        const result = InboundEventSchema.safeParse({
            traceId: 'tr_abc123',
            timestamp: '2026-01-01T00:00:00.000Z',
            sessionId: 'ws_xyz',
            service: 'terminal',
            action: 'exec',
            payload: { cmd: 'ls -la' },
        });
        expect(result.success).toBe(true);
    });

    it('should reject missing traceId', () => {
        const result = InboundEventSchema.safeParse({
            timestamp: '2026-01-01T00:00:00.000Z',
            sessionId: 'ws_xyz',
            service: 'terminal',
            action: 'exec',
        });
        expect(result.success).toBe(false);
    });

    it('should reject empty service', () => {
        const result = InboundEventSchema.safeParse({
            traceId: 'tr_abc123',
            timestamp: '2026-01-01T00:00:00.000Z',
            sessionId: 'ws_xyz',
            service: '',
            action: 'exec',
        });
        expect(result.success).toBe(false);
    });

    it('should default payload to empty object', () => {
        const result = InboundEventSchema.safeParse({
            traceId: 'tr_abc123',
            timestamp: '2026-01-01T00:00:00.000Z',
            sessionId: 'ws_xyz',
            service: 'terminal',
            action: 'exec',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.payload).toEqual({});
        }
    });
});

describe('ServiceCommandSchema', () => {
    it('should accept a valid service command', () => {
        const result = ServiceCommandSchema.safeParse({
            traceId: 'tr_abc123',
            timestamp: '2026-01-01T00:00:00.000Z',
            userId: 'u_42',
            roles: ['developer'],
            action: 'exec',
            payload: { cmd: 'ls -la' },
            replyTo: 'terminal:results:ws_xyz',
        });
        expect(result.success).toBe(true);
    });

    it('should reject missing replyTo', () => {
        const result = ServiceCommandSchema.safeParse({
            traceId: 'tr_abc123',
            timestamp: '2026-01-01T00:00:00.000Z',
            userId: 'u_42',
            roles: ['developer'],
            action: 'exec',
        });
        expect(result.success).toBe(false);
    });
});

describe('ServiceResultSchema', () => {
    it('should accept a valid streaming result', () => {
        const result = ServiceResultSchema.safeParse({
            traceId: 'tr_abc123',
            timestamp: '2026-01-01T00:00:00.000Z',
            status: 'ok',
            stream: 'total 42\ndrwxr-xr-x  2 user user 4096 Jan  1 00:00 .\n',
            done: false,
        });
        expect(result.success).toBe(true);
    });

    it('should accept a final result', () => {
        const result = ServiceResultSchema.safeParse({
            traceId: 'tr_abc123',
            timestamp: '2026-01-01T00:00:00.000Z',
            status: 'ok',
            done: true,
        });
        expect(result.success).toBe(true);
    });

    it('should accept an error result', () => {
        const result = ServiceResultSchema.safeParse({
            traceId: 'tr_abc123',
            timestamp: '2026-01-01T00:00:00.000Z',
            status: 'error',
            payload: { code: 'PERMISSION_DENIED', message: 'Not allowed' },
            done: true,
        });
        expect(result.success).toBe(true);
    });

    it('should reject invalid status', () => {
        const result = ServiceResultSchema.safeParse({
            traceId: 'tr_abc123',
            timestamp: '2026-01-01T00:00:00.000Z',
            status: 'pending',
            done: false,
        });
        expect(result.success).toBe(false);
    });
});

describe('AuditEntrySchema', () => {
    it('should accept a valid audit entry', () => {
        const result = AuditEntrySchema.safeParse({
            traceId: 'tr_abc123',
            timestamp: '2026-01-01T00:00:00.000Z',
            userId: 'u_42',
            action: 'exec',
            service: 'terminal',
            step: 'rbac_checked',
        });
        expect(result.success).toBe(true);
    });
});

describe('SessionInfoSchema', () => {
    it('should accept a valid session', () => {
        const result = SessionInfoSchema.safeParse({
            userId: 'u_42',
            roles: ['developer', 'admin'],
            connectedAt: '2026-01-01T00:00:00.000Z',
        });
        expect(result.success).toBe(true);
    });
});

describe('ServiceRegistryEntrySchema', () => {
    it('should accept a valid registry entry', () => {
        const result = ServiceRegistryEntrySchema.safeParse({
            serviceName: 'terminal-service',
            lastHeartbeat: '2026-01-01T00:00:00.000Z',
            channels: ['terminal:commands'],
        });
        expect(result.success).toBe(true);
    });
});
