/**
 * Tests for @orch/gateway — RBAC permission checking and rate limiting
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { checkPermission, RateLimiter } from './middleware.js';
import type { RolePermissions } from '@orch/event-contracts';
import { DEFAULT_ROLES } from '@orch/event-contracts';

// ─── checkPermission ────────────────────────────────────────────────────────

describe('checkPermission', () => {
    it('should allow admin all permissions', () => {
        expect(checkPermission(['admin'], 'terminal', 'exec')).toBe(true);
        expect(checkPermission(['admin'], 'vault', 'admin')).toBe(true);
        expect(checkPermission(['admin'], 'ai', 'chat')).toBe(true);
        expect(checkPermission(['admin'], 'fs', 'write')).toBe(true);
    });

    it('should allow guest only ai:chat', () => {
        expect(checkPermission(['guest'], 'ai', 'chat')).toBe(true);
    });

    it('should deny guest terminal access (explicit deny)', () => {
        expect(checkPermission(['guest'], 'terminal', 'exec')).toBe(false);
    });

    it('should deny guest vault access (explicit deny)', () => {
        expect(checkPermission(['guest'], 'vault', 'read')).toBe(false);
    });

    it('should deny guest fs:write (explicit deny)', () => {
        expect(checkPermission(['guest'], 'fs', 'write')).toBe(false);
    });

    it('should allow developer terminal:exec', () => {
        expect(checkPermission(['developer'], 'terminal', 'exec')).toBe(true);
    });

    it('should allow developer ai:* (wildcard)', () => {
        expect(checkPermission(['developer'], 'ai', 'chat')).toBe(true);
        expect(checkPermission(['developer'], 'ai', 'stream')).toBe(true);
    });

    it('should allow developer fs:read and fs:write', () => {
        expect(checkPermission(['developer'], 'fs', 'read')).toBe(true);
        expect(checkPermission(['developer'], 'fs', 'write')).toBe(true);
    });

    it('should deny developer vault:admin (explicit deny)', () => {
        expect(checkPermission(['developer'], 'vault', 'admin')).toBe(false);
    });

    it('should deny unknown roles', () => {
        expect(checkPermission(['unknown'], 'ai', 'chat')).toBe(false);
    });

    it('should deny empty roles', () => {
        expect(checkPermission([], 'ai', 'chat')).toBe(false);
    });

    it('should work with custom role store', () => {
        const custom: Record<string, RolePermissions> = {
            tester: {
                permissions: ['test:run', 'test:view'],
                deny: ['test:delete'],
            },
        };

        expect(checkPermission(['tester'], 'test', 'run', custom)).toBe(true);
        expect(checkPermission(['tester'], 'test', 'view', custom)).toBe(true);
        expect(checkPermission(['tester'], 'test', 'delete', custom)).toBe(false);
        expect(checkPermission(['tester'], 'test', 'create', custom)).toBe(false);
    });

    it('should check deny before allow across multiple roles', () => {
        // guest denies terminal:*, even if another role would allow it
        // But since we check per-role: guest deny wins for guest, developer allow wins for developer
        expect(checkPermission(['guest', 'developer'], 'terminal', 'exec')).toBe(false);
    });
});

// ─── RateLimiter ────────────────────────────────────────────────────────────

describe('RateLimiter', () => {
    let limiter: RateLimiter;

    beforeEach(() => {
        limiter = new RateLimiter(5, 1); // 5 tokens max, 1 per second refill
    });

    it('should allow requests within the limit', () => {
        expect(limiter.consume('user1')).toBe(true);
        expect(limiter.consume('user1')).toBe(true);
        expect(limiter.consume('user1')).toBe(true);
    });

    it('should deny when tokens exhausted', () => {
        for (let i = 0; i < 5; i++) {
            expect(limiter.consume('user1')).toBe(true);
        }
        expect(limiter.consume('user1')).toBe(false);
    });

    it('should track users independently', () => {
        for (let i = 0; i < 5; i++) {
            limiter.consume('user1');
        }
        expect(limiter.consume('user1')).toBe(false);
        expect(limiter.consume('user2')).toBe(true);
    });

    it('should reset all buckets', () => {
        for (let i = 0; i < 5; i++) {
            limiter.consume('user1');
        }
        expect(limiter.consume('user1')).toBe(false);

        limiter.reset();
        expect(limiter.consume('user1')).toBe(true);
    });
});
