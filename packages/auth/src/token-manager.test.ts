/**
 * Tests for @orch/auth/token-manager — persistent token CRUD + validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3-multiple-ciphers';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { TokenManager } from './token-manager.js';

describe('TokenManager', () => {
    let tempDir: string;
    let db: InstanceType<typeof Database>;
    let mgr: TokenManager;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'orch-token-test-'));
        db = new Database(join(tempDir, 'test.db'));
        const orm = drizzle(db);
        mgr = new TokenManager(orm, { maxTokensPerIdentity: 3 });
        mgr.initSchema(db);
    });

    afterEach(() => {
        db.close();
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('creates a token and returns the raw value once', () => {
        const { token, rawToken } = mgr.create({
            name: 'my-token',
            identity: 'user-1',
            tokenType: 'user',
            roles: ['viewer'],
            scopes: ['agent:read'],
        });

        expect(rawToken).toMatch(/^orch_[a-f0-9]{64}$/);
        expect(token.name).toBe('my-token');
        expect(token.identity).toBe('user-1');
        expect(token.tokenType).toBe('user');
        expect(token.roles).toEqual(['viewer']);
        expect(token.scopes).toEqual(['agent:read']);
        expect(token.revoked).toBe(false);
        expect(token.expiresAt).toBeNull();
    });

    it('creates a token with TTL', () => {
        const { token } = mgr.create({
            name: 'short-lived',
            identity: 'user-1',
            tokenType: 'user',
            roles: [],
            scopes: [],
            ttlSecs: 3600,
        });

        expect(token.expiresAt).toBeDefined();
        const expires = new Date(token.expiresAt!).getTime();
        const now = Date.now();
        expect(expires).toBeGreaterThan(now + 3500 * 1000);
        expect(expires).toBeLessThan(now + 3700 * 1000);
    });

    it('validates a token and returns identity+roles+scopes', () => {
        const { rawToken } = mgr.create({
            name: 'api-key',
            identity: 'agent-42',
            tokenType: 'agent',
            roles: ['admin'],
            scopes: ['mcp:*'],
        });

        const validated = mgr.validate(rawToken);
        expect(validated.identity).toBe('agent-42');
        expect(validated.tokenType).toBe('agent');
        expect(validated.roles).toEqual(['admin']);
        expect(validated.scopes).toEqual(['mcp:*']);
    });

    it('throws on unknown raw token', () => {
        expect(() => mgr.validate('orch_' + '0'.repeat(64))).toThrow();
    });

    it('throws when validating a revoked token', () => {
        const { token, rawToken } = mgr.create({
            name: 'temp',
            identity: 'user-1',
            tokenType: 'user',
            roles: [],
            scopes: [],
        });

        mgr.revoke(token.id);
        expect(() => mgr.validate(rawToken)).toThrow();
    });

    it('throws when validating an expired token', () => {
        // Create a token then manually backdate its expiry via direct DB update
        const { token, rawToken } = mgr.create({
            name: 'expiring',
            identity: 'user-1',
            tokenType: 'user',
            roles: [],
            scopes: [],
            ttlSecs: 3600,
        });
        // Force expiry to the past
        db.prepare('UPDATE persistent_tokens SET expires_at = ? WHERE id = ?')
            .run(new Date(Date.now() - 5000).toISOString(), token.id);

        expect(() => mgr.validate(rawToken)).toThrow();
    });

    it('lists tokens by identity', () => {
        mgr.create({ name: 'a', identity: 'user-1', tokenType: 'user', roles: [], scopes: [] });
        mgr.create({ name: 'b', identity: 'user-1', tokenType: 'user', roles: [], scopes: [] });
        mgr.create({ name: 'c', identity: 'user-2', tokenType: 'user', roles: [], scopes: [] });

        const user1Tokens = mgr.listByIdentity('user-1');
        expect(user1Tokens).toHaveLength(2);
        expect(user1Tokens.map((t) => t.name).sort()).toEqual(['a', 'b']);

        const user2Tokens = mgr.listByIdentity('user-2');
        expect(user2Tokens).toHaveLength(1);
    });

    it('lists all active tokens', () => {
        const { token: t1 } = mgr.create({ name: 'a', identity: 'user-1', tokenType: 'user', roles: [], scopes: [] });
        mgr.create({ name: 'b', identity: 'user-1', tokenType: 'user', roles: [], scopes: [] });
        mgr.revoke(t1.id);

        const active = mgr.listActive();
        expect(active).toHaveLength(1);
        expect(active[0].name).toBe('b');
    });

    it('enforces max tokens per identity', () => {
        mgr.create({ name: 'a', identity: 'user-1', tokenType: 'user', roles: [], scopes: [] });
        mgr.create({ name: 'b', identity: 'user-1', tokenType: 'user', roles: [], scopes: [] });
        mgr.create({ name: 'c', identity: 'user-1', tokenType: 'user', roles: [], scopes: [] });

        expect(() =>
            mgr.create({ name: 'd', identity: 'user-1', tokenType: 'user', roles: [], scopes: [] }),
        ).toThrow();
    });

    it('revokes all tokens for an identity', () => {
        mgr.create({ name: 'a', identity: 'user-1', tokenType: 'user', roles: [], scopes: [] });
        mgr.create({ name: 'b', identity: 'user-1', tokenType: 'user', roles: [], scopes: [] });

        const count = mgr.revokeAllForIdentity('user-1');
        expect(count).toBe(2);
        expect(mgr.listActive()).toHaveLength(0);
    });

    it('cleanup removes expired tokens and returns count', () => {
        // Create a token then force its expiry to the past
        const { token: expiredToken } = mgr.create({ name: 'expired', identity: 'user-1', tokenType: 'user', roles: [], scopes: [], ttlSecs: 3600 });
        db.prepare('UPDATE persistent_tokens SET expires_at = ? WHERE id = ?')
            .run(new Date(Date.now() - 5000).toISOString(), expiredToken.id);
        mgr.create({ name: 'valid', identity: 'user-1', tokenType: 'user', roles: [], scopes: [] });

        const removed = mgr.cleanup();
        expect(removed).toBe(1);
        const remaining = mgr.listByIdentity('user-1');
        expect(remaining.map((t) => t.name)).toContain('valid');
    });
});
