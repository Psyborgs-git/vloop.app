/**
 * Tests for @orch/auth/session — session lifecycle
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3-multiple-ciphers';
import { SessionManager } from './session.js';

describe('SessionManager', () => {
    let tempDir: string;
    let db: InstanceType<typeof Database>;
    let mgr: SessionManager;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'orch-session-test-'));
        db = new Database(join(tempDir, 'test.db'));
        mgr = new SessionManager(db, {
            idleTimeoutSecs: 3600,
            maxLifetimeSecs: 86400,
            maxSessionsPerIdentity: 5,
        });
    });

    afterEach(() => {
        db.close();
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('should create a session and return a token', () => {
        const { session, token } = mgr.create('user@example.com', ['admin']);

        expect(session.id).toBeDefined();
        expect(session.identity).toBe('user@example.com');
        expect(session.roles).toEqual(['admin']);
        expect(token).toHaveLength(64); // 32 bytes hex
        expect(session.createdAt).toBeDefined();
        expect(session.expiresAt).toBeDefined();
    });

    it('should validate a session with the correct token', () => {
        const { token } = mgr.create('user@test.com', ['viewer']);
        const session = mgr.validate(token);

        expect(session.identity).toBe('user@test.com');
        expect(session.roles).toEqual(['viewer']);
    });

    it('should reject an invalid token', () => {
        mgr.create('user@test.com', ['viewer']);
        expect(() => mgr.validate('wrong-token-123')).toThrow('Session not found or has been revoked');
    });

    it('should revoke a session', () => {
        const { session, token } = mgr.create('user@test.com', ['admin']);
        mgr.revoke(session.id);

        expect(() => mgr.validate(token)).toThrow('Session not found or has been revoked');
    });

    it('should refresh a session and extend expiry', () => {
        const { session } = mgr.create('user@test.com', ['admin']);
        const refreshed = mgr.refresh(session.id);

        expect(refreshed.id).toBe(session.id);
        expect(new Date(refreshed.expiresAt).getTime()).toBeGreaterThan(
            new Date(session.expiresAt).getTime(),
        );
    });

    it('should list active sessions', () => {
        mgr.create('user1@test.com', ['admin']);
        mgr.create('user2@test.com', ['viewer']);
        mgr.create('user3@test.com', ['operator']);

        const active = mgr.listActive();
        expect(active).toHaveLength(3);
        expect(active.map((s) => s.identity).sort()).toEqual([
            'user1@test.com',
            'user2@test.com',
            'user3@test.com',
        ]);
    });

    it('should enforce max sessions per identity', () => {
        const limitedMgr = new SessionManager(db, {
            idleTimeoutSecs: 3600,
            maxLifetimeSecs: 86400,
            maxSessionsPerIdentity: 2,
        });

        limitedMgr.create('user@test.com', ['admin']);
        limitedMgr.create('user@test.com', ['admin']);

        expect(() => limitedMgr.create('user@test.com', ['admin'])).toThrow(
            'Max concurrent sessions',
        );
    });

    it('should clean up expired sessions', () => {
        // Create with very short timeout
        const shortMgr = new SessionManager(db, {
            idleTimeoutSecs: -1, // Already expired
            maxLifetimeSecs: -1,
            maxSessionsPerIdentity: 100,
        });

        shortMgr.create('user@test.com', ['admin']);
        const cleaned = shortMgr.cleanup();
        expect(cleaned).toBeGreaterThanOrEqual(1);
    });
});
