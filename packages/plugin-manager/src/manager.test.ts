import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import Database from 'better-sqlite3-multiple-ciphers';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { PluginManager } from '../src/manager.js';
import { DatabaseProvisioner } from '@orch/db-manager';
import type { Logger } from '@orch/daemon';

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
    rm: vi.fn(),
}));

const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
} as unknown as Logger;

const mockDbProvisioner = {
    provision: vi.fn(),
    getCredentials: vi.fn(),
} as unknown as DatabaseProvisioner;

describe('PluginManager', () => {
    let manager: PluginManager;
    let db: Database.Database;
    let orm: any;
    const testDataDir = './test-data/plugins';

    beforeEach(() => {
        vi.clearAllMocks();
        db = new Database(':memory:');
        orm = drizzle(db);
        manager = new PluginManager(db, orm, mockDbProvisioner, mockLogger, testDataDir);
    });

    it('should list plugins from store', () => {
        const plugins = manager.list();
        expect(plugins).toEqual([]);
    });

    it('should uninstall plugin: delete files then remove from store', async () => {
        const pluginId = 'test-plugin';
        const expectedPath = join(process.cwd(), testDataDir, pluginId);

        const manifest = {
            id: pluginId,
            name: 'Test Plugin',
            version: '1.0.0',
            description: 'for tests',
            permissions: [],
            hooks: {},
            runtime: 'wasm',
            entrypoint: 'plugin.wasm',
        } as any;
        const now = new Date().toISOString();
        db.exec(`
            INSERT INTO plugins (id, enabled, manifest, granted_permissions, installed_at, db_id)
            VALUES ('${pluginId}', 1, '${JSON.stringify(manifest).replace(/'/g, "''")}', '[]', '${now}', NULL)
        `);

        await manager.uninstall(pluginId);

        // Check rm called
        expect(rm).toHaveBeenCalledWith(expectedPath, { recursive: true, force: true });
        expect(manager.list()).toEqual([]);
    });

    it('should not remove from store if file deletion fails', async () => {
        const pluginId = 'fail-plugin';
        const expectedPath = join(process.cwd(), testDataDir, pluginId);

        const manifest = {
            id: pluginId,
            name: 'Fail Plugin',
            version: '1.0.0',
            description: 'for tests',
            permissions: [],
            hooks: {},
            runtime: 'wasm',
            entrypoint: 'plugin.wasm',
        } as any;
        const now = new Date().toISOString();
        db.exec(`
            INSERT INTO plugins (id, enabled, manifest, granted_permissions, installed_at, db_id)
            VALUES ('${pluginId}', 1, '${JSON.stringify(manifest).replace(/'/g, "''")}', '[]', '${now}', NULL)
        `);

        // Mock rm rejection
        (rm as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Deletion failed'));

        await expect(manager.uninstall(pluginId)).rejects.toThrow('Deletion failed');

        expect(rm).toHaveBeenCalledWith(expectedPath, { recursive: true, force: true });
        expect(manager.list().map((p) => p.id)).toContain(pluginId);
    });
});
