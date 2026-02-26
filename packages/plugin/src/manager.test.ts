import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PluginManager } from './manager';
import { PluginStore } from './store';
import { HookService } from './hook-service';
import Database from 'better-sqlite3-multiple-ciphers';
import { rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

describe('PluginManager', () => {
    let db: any;
    let store: PluginStore;
    let hookService: HookService;
    let logger: any;
    let manager: PluginManager;
    let vaultStore: any;
    const testDir = join(__dirname, '../../test-plugins');

    beforeEach(() => {
        db = new Database(':memory:');
        logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
        store = new PluginStore(db, logger);
        hookService = new HookService(logger);

        // Mock Vault
        vaultStore = { get: vi.fn() };

        // Clean test dir
        try { rmSync(testDir, { recursive: true, force: true }); } catch {}
        mkdirSync(testDir, { recursive: true });

        manager = new PluginManager(logger, store, hookService, vaultStore, testDir);
    });

    afterEach(() => {
        db.close();
        try { rmSync(testDir, { recursive: true, force: true }); } catch {}
    });

    it('should initialize with empty plugin list', () => {
        expect(manager.list()).toHaveLength(0);
    });

    // Vault Tests
    it('should deny vault access if permission missing', async () => {
        const pluginId = 'test-plugin';
        store.add({
            id: pluginId,
            version: '1.0.0',
            name: 'Test',
            runtime: 'node',
            entry: 'index.js',
            permissions: []
        });

        const req = {
            type: 'request',
            id: '1',
            action: 'vault.get',
            args: { key: 'secret/db' }
        };

        await expect((manager as any).executePluginRequest(pluginId, req))
            .rejects.toThrow('Permission denied for vault key: secret/db');
    });

    it('should allow vault access if global permission granted', async () => {
        const pluginId = 'test-plugin';
        store.add({
            id: pluginId,
            version: '1.0.0',
            name: 'Test',
            runtime: 'node',
            entry: 'index.js',
            permissions: []
        });

        store.grantPermissions(pluginId, ['vault:read']);
        vaultStore.get.mockReturnValue({ value: 's3cr3t' });

        const req = {
            type: 'request',
            id: '1',
            action: 'vault.get',
            args: { key: 'secret/db' }
        };

        const result = await (manager as any).executePluginRequest(pluginId, req);
        expect(result).toBe('s3cr3t');
    });

    it('should allow vault access if specific permission granted', async () => {
        const pluginId = 'test-plugin';
        store.add({
            id: pluginId,
            version: '1.0.0',
            name: 'Test',
            runtime: 'node',
            entry: 'index.js',
            permissions: []
        });

        store.grantPermissions(pluginId, ['vault:read:secret/db']);
        vaultStore.get.mockReturnValue({ value: 's3cr3t' });

        const req = {
            type: 'request',
            id: '1',
            action: 'vault.get',
            args: { key: 'secret/db' }
        };

        const result = await (manager as any).executePluginRequest(pluginId, req);
        expect(result).toBe('s3cr3t');
    });

    it('should deny vault access if specific permission mismatch', async () => {
        const pluginId = 'test-plugin';
        store.add({
            id: pluginId,
            version: '1.0.0',
            name: 'Test',
            runtime: 'node',
            entry: 'index.js',
            permissions: []
        });

        store.grantPermissions(pluginId, ['vault:read:secret/other']);

        const req = {
            type: 'request',
            id: '1',
            action: 'vault.get',
            args: { key: 'secret/db' }
        };

        await expect((manager as any).executePluginRequest(pluginId, req))
            .rejects.toThrow('Permission denied for vault key: secret/db');
    });

    // Hook Tests
    it('should deny hook subscription if permission missing', async () => {
        const pluginId = 'test-plugin';
        store.add({
            id: pluginId,
            version: '1.0.0',
            name: 'Test',
            runtime: 'node',
            entry: 'index.js',
            permissions: []
        });

        const req = {
            type: 'request',
            id: '1',
            action: 'hooks.subscribe',
            args: { topic: 'container.created' }
        };

        await expect((manager as any).executePluginRequest(pluginId, req))
            .rejects.toThrow('Permission denied for hook subscription: container.created');
    });

    it('should allow hook subscription if specific permission granted', async () => {
        const pluginId = 'test-plugin';
        store.add({
            id: pluginId,
            version: '1.0.0',
            name: 'Test',
            runtime: 'node',
            entry: 'index.js',
            permissions: []
        });

        store.grantPermissions(pluginId, ['hook:read:container.created']);

        const req = {
            type: 'request',
            id: '1',
            action: 'hooks.subscribe',
            args: { topic: 'container.created' }
        };

        const result = await (manager as any).executePluginRequest(pluginId, req);
        expect(result).toBe(true);
    });

    it('should allow hook subscription if global permission granted', async () => {
        const pluginId = 'test-plugin';
        store.add({
            id: pluginId,
            version: '1.0.0',
            name: 'Test',
            runtime: 'node',
            entry: 'index.js',
            permissions: []
        });

        store.grantPermissions(pluginId, ['hook:read:*']);

        const req = {
            type: 'request',
            id: '1',
            action: 'hooks.subscribe',
            args: { topic: 'container.created' }
        };

        const result = await (manager as any).executePluginRequest(pluginId, req);
        expect(result).toBe(true);
    });
});
