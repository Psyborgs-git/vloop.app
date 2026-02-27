import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { PluginManager } from '../src/manager.js';
import { DatabaseProvisioner } from '@orch/db-manager';
import type { Logger } from '@orch/daemon';
import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
    rm: vi.fn(),
}));

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
    const testDataDir = './test-data/plugins';

    beforeEach(() => {
        vi.clearAllMocks();

        // Setup default mock returns for DB
        (mockDb.prepare as any).mockReturnValue({
            run: vi.fn(),
            get: vi.fn(),
            all: vi.fn().mockReturnValue([]),
        });

        manager = new PluginManager(mockDb, mockDbProvisioner, mockLogger, testDataDir);
    });

    it('should list plugins from store', () => {
        const plugins = manager.list();
        expect(plugins).toEqual([]);
        expect(mockDb.prepare).toHaveBeenCalledWith('SELECT * FROM plugins');
    });

    it('should uninstall plugin: delete files then remove from store', async () => {
        const pluginId = 'test-plugin';
        const expectedPath = join(process.cwd(), testDataDir, pluginId);

        // Mock DB prepare for uninstall
        const mockRun = vi.fn();
        (mockDb.prepare as any).mockImplementation((query: string) => {
            if (query.includes('DELETE FROM plugins')) {
                return { run: mockRun };
            }
            return { run: vi.fn(), get: vi.fn(), all: vi.fn().mockReturnValue([]) };
        });

        await manager.uninstall(pluginId);

        // Check rm called
        expect(rm).toHaveBeenCalledWith(expectedPath, { recursive: true, force: true });

        // Check store uninstall called
        expect(mockRun).toHaveBeenCalledWith(pluginId);
    });

    it('should not remove from store if file deletion fails', async () => {
        const pluginId = 'fail-plugin';
        const expectedPath = join(process.cwd(), testDataDir, pluginId);

        // Mock rm rejection
        (rm as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Deletion failed'));

         const mockRun = vi.fn();
        (mockDb.prepare as any).mockImplementation((query: string) => {
             if (query.includes('DELETE FROM plugins')) {
                return { run: mockRun };
            }
            return { run: vi.fn(), get: vi.fn(), all: vi.fn().mockReturnValue([]) };
        });

        await expect(manager.uninstall(pluginId)).rejects.toThrow('Deletion failed');

        expect(rm).toHaveBeenCalledWith(expectedPath, { recursive: true, force: true });
        expect(mockRun).not.toHaveBeenCalled();
    });
});
