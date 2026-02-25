/**
 * Tests for @orch/vault/store — Secret CRUD with encryption + versioning
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3-multiple-ciphers';
import { VaultStore } from './store.js';
import { VaultCrypto } from './crypto.js';

describe('VaultStore', () => {
    let tempDir: string;
    let db: InstanceType<typeof Database>;
    let crypto: VaultCrypto;
    let store: VaultStore;

    beforeEach(async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'orch-vault-test-'));
        db = new Database(join(tempDir, 'vault.db'));
        crypto = new VaultCrypto();
        store = new VaultStore(db, crypto, 3); // max 3 versions

        // Initialize vault with passphrase
        await store.init('test-vault-passphrase');
    });

    afterEach(() => {
        crypto.zeroize();
        db.close();
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('should create and retrieve a secret', () => {
        const meta = store.create('api-key', 'sk-abc123');

        expect(meta.name).toBe('api-key');
        expect(meta.version).toBe(1);
        expect(meta.createdAt).toBeDefined();

        const secret = store.get('api-key');
        expect(secret.name).toBe('api-key');
        expect(secret.value).toBe('sk-abc123');
        expect(secret.version).toBe(1);
    });

    it('should reject duplicate secret names', () => {
        store.create('my-secret', 'value1');
        expect(() => store.create('my-secret', 'value2')).toThrow('already exists');
    });

    it('should update a secret and create new version', () => {
        store.create('config', 'v1-data');
        const updated = store.update('config', 'v2-data');

        expect(updated.version).toBe(2);

        const latest = store.get('config');
        expect(latest.value).toBe('v2-data');
        expect(latest.version).toBe(2);

        // Old version still accessible
        const v1 = store.get('config', 1);
        expect(v1.value).toBe('v1-data');
    });

    it('should prune old versions beyond maxVersions', () => {
        store.create('rotating', 'v1');
        store.update('rotating', 'v2');
        store.update('rotating', 'v3');
        store.update('rotating', 'v4'); // Should prune v1

        const latest = store.get('rotating');
        expect(latest.version).toBe(4);

        // v1 should be pruned (maxVersions=3)
        expect(() => store.get('rotating', 1)).toThrow('not found');

        // v2 should still exist
        const v2 = store.get('rotating', 2);
        expect(v2.value).toBe('v2');
    });

    it('should soft delete a secret', () => {
        store.create('temp-key', 'temp-value');
        store.delete('temp-key');

        expect(() => store.get('temp-key')).toThrow('not found');
    });

    it('should throw when deleting non-existent secret', () => {
        expect(() => store.delete('nonexistent')).toThrow('not found');
    });

    it('should list secrets without exposing values', () => {
        store.create('key-1', 'value-1', { env: 'prod' });
        store.create('key-2', 'value-2');
        store.create('key-3', 'value-3');

        const list = store.list();
        expect(list).toHaveLength(3);
        expect(list.map((s) => s.name).sort()).toEqual(['key-1', 'key-2', 'key-3']);

        // Values should NOT be exposed in list
        for (const item of list) {
            expect((item as Record<string, unknown>)['value']).toBeUndefined();
        }
    });

    it('should list secrets with prefix filter', () => {
        store.create('app-db-url', 'postgres://...');
        store.create('app-api-key', 'sk-...');
        store.create('other-key', 'value');

        const appSecrets = store.list({ prefix: 'app-' });
        expect(appSecrets).toHaveLength(2);
        expect(appSecrets.every((s) => s.name.startsWith('app-'))).toBe(true);
    });

    it('should store and retrieve metadata', () => {
        store.create('with-meta', 'value', { owner: 'team-a', environment: 'staging' });
        const secret = store.get('with-meta');
        expect(secret.metadata).toEqual({ owner: 'team-a', environment: 'staging' });
    });

    it('should throw when updating non-existent secret', () => {
        expect(() => store.update('nonexistent', 'value')).toThrow('not found');
    });

    it('should deny access to system secrets for regular users', () => {
        store.create('sys-secret', 'sys-val', undefined, '__system__');

        const requester = { identity: 'bob', roles: ['user'] };

        expect(() => store.get('sys-secret', undefined, requester)).toThrow('Access denied');
        expect(() => store.update('sys-secret', 'new-val', undefined, requester)).toThrow('Access denied');
    });

    it('should allow admin to access system secrets', () => {
        store.create('sys-secret-2', 'sys-val-2', undefined, '__system__');

        const requester = { identity: 'alice', roles: ['admin'] };

        const secret = store.get('sys-secret-2', undefined, requester);
        expect(secret.value).toBe('sys-val-2');

        const updated = store.update('sys-secret-2', 'new-val-2', undefined, requester);
        expect(updated.version).toBe(2);
    });
});
