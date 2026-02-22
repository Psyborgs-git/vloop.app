import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabasePool } from './pooler.js';
import { DatabaseProvisioner } from './provisioner.js';
import { Logger } from '@orch/daemon';
import { OrchestratorError } from '@orch/shared';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('DatabasePool', () => {
    let pool: DatabasePool;
    let provisioner: DatabaseProvisioner;
    let mockVault: any;
    let mockLogger: vi.Mocked<Logger>;
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'pool-test-'));
        mockVault = {
            create: vi.fn(),
            get: vi.fn(),
        };
        mockLogger = {
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
        } as any;

        provisioner = new DatabaseProvisioner(tmpDir, mockVault, mockLogger);
        pool = new DatabasePool(provisioner, mockLogger);
    });

    afterEach(() => {
        pool.shutdownAll();
        rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('connects to a DB, caching the connection, and executes raw SQL', async () => {
        // Provision a real encrypted DB for the test
        const { dbId } = await provisioner.provision({ workspaceId: 'ws-1' });

        // Mock the Vault read since we bypassed real Vault
        const callArgs = mockVault.create.mock.calls[0];
        const storedKey = callArgs[1];
        mockVault.get.mockResolvedValueOnce({ value: storedKey });

        // First connection execution
        await pool.executeRaw('ws-1', dbId, `CREATE TABLE test (id INTEGER PRIMARY KEY, msg TEXT)`);

        // Caches connection handle - mockVault.get should NOT be called again if cached
        mockVault.get.mockClear();

        await pool.executeRaw('ws-1', dbId, `INSERT INTO test (msg) VALUES (?)`, ['hello world']);
        const { rows } = await pool.executeRaw('ws-1', dbId, `SELECT * FROM test`);

        expect(mockVault.get).not.toHaveBeenCalled(); // Validates connection pooling
        expect(rows).toHaveLength(1);
        expect(rows![0].msg).toBe('hello world');
    });

    it('disconnects and cleans up properly', async () => {
        const { dbId } = await provisioner.provision({ workspaceId: 'ws-2' });
        mockVault.get.mockResolvedValueOnce({ value: mockVault.create.mock.calls[0][1] });

        await pool.connect('ws-2', dbId);
        pool.disconnect('ws-2', dbId);

        // Attempting to query should fetch key again as cache was cleared
        mockVault.get.mockResolvedValueOnce({ value: mockVault.create.mock.calls[0][1] });
        await pool.executeRaw('ws-2', dbId, 'SELECT 1');

        expect(mockVault.get).toHaveBeenCalledTimes(2);
    });
});
