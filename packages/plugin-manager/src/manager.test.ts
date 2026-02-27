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
});
