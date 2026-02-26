import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { PluginStore } from './store';
import type { PluginManifest } from './types';

describe('PluginStore', () => {
    let db: any;
    let store: PluginStore;
    let logger: any;

    beforeEach(() => {
        db = new Database(':memory:');
        logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn() };
        store = new PluginStore(db, logger);
    });

    afterEach(() => {
        db.close();
    });

    const manifest: PluginManifest = {
        id: 'test-plugin',
        version: '1.0.0',
        name: 'Test Plugin',
        runtime: 'node',
        entry: 'index.js'
    };

    it('should add and retrieve a plugin', () => {
        store.add(manifest);
        const plugin = store.get('test-plugin');
        expect(plugin).toBeDefined();
        expect(plugin?.id).toBe('test-plugin');
        expect(plugin?.status).toBe('pending');
    });

    it('should update status', () => {
        store.add(manifest);
        store.updateStatus('test-plugin', 'active');
        const plugin = store.get('test-plugin');
        expect(plugin?.status).toBe('active');
    });

    it('should grant permissions', () => {
        store.add(manifest);
        store.grantPermissions('test-plugin', ['vault:read']);
        const plugin = store.get('test-plugin');
        expect(plugin?.permissions).toEqual(['vault:read']);
    });

    it('should delete a plugin', () => {
        store.add(manifest);
        store.delete('test-plugin');
        const plugin = store.get('test-plugin');
        expect(plugin).toBeUndefined();
    });
});
