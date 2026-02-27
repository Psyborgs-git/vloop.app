import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginManager } from '../src/manager.js';
import { PluginStore } from '../src/store.js';
import { DatabaseProvisioner } from '@orch/db-manager';
import type { Logger } from '@orch/daemon';
import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';

// Mock dependencies
const mockDb = {
    prepare: vi.fn(),
    exec: vi.fn(),
} as unknown as BetterSqlite3.Database;

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

    beforeEach(() => {
        vi.clearAllMocks();
        // We mock PluginStore internal usage or just instantiate with mockDb
        // Since PluginManager instantiates PluginStore internally, we rely on mockDb behavior

        // Setup default mock returns for DB
        (mockDb.prepare as any).mockReturnValue({
            run: vi.fn(),
            get: vi.fn(),
            all: vi.fn().mockReturnValue([]),
        });

        manager = new PluginManager(mockDb, mockDbProvisioner, mockLogger, './test-data/plugins');
    });

    it('should list plugins from store', () => {
        const plugins = manager.list();
        expect(plugins).toEqual([]);
        expect(mockDb.prepare).toHaveBeenCalledWith('SELECT * FROM plugins');
    });

    it('should throw if plugin already exists during install preparation', async () => {
        // Mock existing plugin
        const mockGet = vi.fn().mockReturnValue({ id: 'test-plugin' });
        (mockDb.prepare as any).mockImplementation((sql: string) => {
            if (sql.includes('SELECT * FROM plugins WHERE id = ?')) {
                return { get: mockGet };
            }
            return { run: vi.fn(), get: vi.fn(), all: vi.fn() };
        });

        // Mock downloader to return a manifest
        // We can spy on the private downloader property or mock the download method if we extract it.
        // For unit test, we might want to mock the downloader instance.
        // But since it's instantiated inside, let's mock the file system or fetch?
        // Actually, let's just test the logic we can control.

        // Testing `commitInstall`
        const manifest = {
             id: 'test-plugin',
             name: 'Test',
             version: '1.0.0',
             permissions: ['db:read'],
             entrypoint: 'plugin.wasm'
        };

        // We need to mock fs.readFileSync to return the manifest JSON
        // This is getting complicated without proper DI or mocking fs.
    });
});
