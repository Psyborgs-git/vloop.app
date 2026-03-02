/**
 * Integration test: Full vault secret lifecycle.
 *
 * Exercises: init vault → create secret → get → update → list → delete,
 * all through the VaultStore with real encryption.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3-multiple-ciphers';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { VaultCrypto } from '../../packages/vault/src/crypto.js';
import { VaultStore } from '../../packages/vault/src/store.js';
import { createVaultHandler } from '../../packages/vault/src/handler.js';
import { SecretInjector } from '../../packages/vault/src/inject.js';

describe('Vault Lifecycle', () => {
    let tempDir: string;
    let db: InstanceType<typeof Database>;
    let orm: ReturnType<typeof drizzle>;
    let crypto: VaultCrypto;
    let store: VaultStore;

    beforeEach(async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'orch-vault-integ-'));
        db = new Database(join(tempDir, 'vault.db'));
        orm = drizzle(db);
        crypto = new VaultCrypto();
        store = new VaultStore(db, orm, crypto);
        await store.init('integration-test-passphrase');
    });

    afterEach(() => {
        crypto.zeroize();
        db.close();
        rmSync(tempDir, { recursive: true, force: true });
    });

    describe('Full CRUD lifecycle', () => {
        it('should create → get → update → list → delete', () => {
            // Create
            const created = store.create('db-password', 's3cret!', { env: 'production' });
            expect(created.name).toBe('db-password');
            expect(created.version).toBe(1);

            // Get
            const secret = store.get('db-password');
            expect(secret.value).toBe('s3cret!');
            expect(secret.metadata).toEqual({ env: 'production' });

            // Update (new version)
            const updated = store.update('db-password', 'n3w-s3cret!');
            expect(updated.version).toBe(2);

            // Get latest
            const latest = store.get('db-password');
            expect(latest.value).toBe('n3w-s3cret!');
            expect(latest.version).toBe(2);

            // Get old version
            const v1 = store.get('db-password', 1);
            expect(v1.value).toBe('s3cret!');

            // List (should show metadata, never values)
            const list = store.list();
            expect(list).toHaveLength(1);
            expect(list[0]!.name).toBe('db-password');
            expect(list[0]!.version).toBe(2);
            expect((list[0] as Record<string, unknown>)['value']).toBeUndefined();

            // Delete (soft)
            store.delete('db-password');
            expect(() => store.get('db-password')).toThrow('not found');

            // List should be empty after delete
            expect(store.list()).toHaveLength(0);
        });
    });

    describe('Vault handler (topic handler)', () => {
        it('should handle secret.create via handler', async () => {
            const handler = createVaultHandler(store);
            const result = await handler('secret.create', {
                name: 'api-key',
                value: 'sk-12345',
            }) as Record<string, unknown>;

            expect(result.name).toBe('api-key');
            expect(result.version).toBe(1);
        });

        it('should handle secret.get via handler', async () => {
            store.create('test-secret', 'test-value');
            const handler = createVaultHandler(store);

            const result = await handler('secret.get', {
                name: 'test-secret',
            }) as Record<string, unknown>;

            expect(result.value).toBe('test-value');
        });

        it('should handle secret.list via handler', async () => {
            store.create('key-1', 'val-1');
            store.create('key-2', 'val-2');
            const handler = createVaultHandler(store);

            const result = await handler('secret.list', {}) as { secrets: unknown[] };
            expect(result.secrets).toHaveLength(2);
        });

        it('should handle secret.update via handler', async () => {
            store.create('rotate-me', 'old-value');
            const handler = createVaultHandler(store);

            const result = await handler('secret.update', {
                name: 'rotate-me',
                value: 'new-value',
            }) as Record<string, unknown>;

            expect(result.version).toBe(2);

            const updated = store.get('rotate-me');
            expect(updated.value).toBe('new-value');
        });

        it('should handle secret.delete via handler', async () => {
            store.create('temp-secret', 'temp-value');
            const handler = createVaultHandler(store);

            const result = await handler('secret.delete', {
                name: 'temp-secret',
            }) as Record<string, unknown>;


            expect(result.ok).toBe(true);
            expect(() => store.get('temp-secret')).toThrow('not found');
        });

        it('should reject unknown actions', async () => {
            const handler = createVaultHandler(store);
            await expect(
                handler('secret.unknown', {}),
            ).rejects.toThrow('Unknown vault action');
        });
    });

    describe('Secret injection', () => {
        it('should resolve ${vault:name} references in strings', () => {
            store.create('db-host', 'localhost:5432');
            store.create('db-pass', 'p@ssw0rd');

            const injector = new SecretInjector(store);
            const resolved = injector.resolveString(
                'postgres://admin:${vault:db-pass}@${vault:db-host}/mydb',
            );

            expect(resolved).toBe('postgres://admin:p@ssw0rd@localhost:5432/mydb');
        });

        it('should resolve ${vault:name} references in env maps', () => {
            store.create('api-key', 'sk-live-123');
            store.create('db-url', 'postgres://prod');

            const injector = new SecretInjector(store);
            const env = injector.resolveEnvMap({
                API_KEY: '${vault:api-key}',
                DATABASE_URL: '${vault:db-url}',
                PLAIN_VAR: 'no-vault-ref-here',
            });

            expect(env.API_KEY).toBe('sk-live-123');
            expect(env.DATABASE_URL).toBe('postgres://prod');
            expect(env.PLAIN_VAR).toBe('no-vault-ref-here');
        });

        it('should detect vault references', () => {
            const injector = new SecretInjector(store);
            expect(injector.hasReferences('${vault:some-key}')).toBe(true);
            expect(injector.hasReferences('no-ref-here')).toBe(false);
        });
    });

    describe('Vault re-initialization (passphrase verification)', () => {
        it('should re-initialize with correct passphrase', async () => {
            store.create('persist-test', 'value-123');
            crypto.zeroize();

            // Re-init with same passphrase
            const crypto2 = new VaultCrypto();
            const store2 = new VaultStore(db, orm, crypto2);
            await store2.init('integration-test-passphrase');

            const secret = store2.get('persist-test');
            expect(secret.value).toBe('value-123');

            crypto2.zeroize();
        });

        it('should reject wrong passphrase on re-init', async () => {
            store.create('sentinel-test', 'value');
            crypto.zeroize();

            const crypto2 = new VaultCrypto();
            const store2 = new VaultStore(db, orm, crypto2);

            await expect(store2.init('wrong-passphrase')).rejects.toThrow('Incorrect vault passphrase');
            crypto2.zeroize();
        });
    });
});
