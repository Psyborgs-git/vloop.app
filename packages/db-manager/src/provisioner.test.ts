import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseProvisioner } from './provisioner.js';
import { VaultStore } from '@orch/vault';
import { Logger } from '@orch/daemon';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import { join } from 'node:path';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('DatabaseProvisioner', () => {
    let provisioner: DatabaseProvisioner;
    let mockVault: vi.Mocked<Partial<VaultStore>>;
    let mockLogger: vi.Mocked<Logger>;
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'db-test-'));
        mockVault = {
            create: vi.fn().mockResolvedValue({}),
            get: vi.fn(),
        };
        mockLogger = {
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            trace: vi.fn(),
            fatal: vi.fn(),
        } as unknown as vi.Mocked<Logger>;

        provisioner = new DatabaseProvisioner(tmpDir, mockVault as any, mockLogger);
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('provisions a new encrypted database and stores key in vault', async () => {
        const result = await provisioner.provision({ workspaceId: 'ws-1', description: 'Test DB' });

        expect(result.dbId).toMatch(/^db_/);
        expect(result.path).toBe(join(tmpDir, `${result.dbId}.sqlite`));
        expect(existsSync(result.path)).toBe(true);
        expect(mockVault.create).toHaveBeenCalledWith(
            `workspaces/ws-1/databases/${result.dbId}/key`,
            expect.any(String),
            { description: 'Test DB' }
        );
    });

    it('retrieves credentials correctly from vault', async () => {
        const fakeKey = 'fake-aes-key';
        mockVault.get!.mockResolvedValueOnce({ value: fakeKey, name: 'key', version: 1 });

        const { dbId } = await provisioner.provision({ workspaceId: 'ws-1' });

        const creds = await provisioner.getCredentials('ws-1', dbId);
        expect(creds.key).toBe(fakeKey);
        expect(creds.path).toBe(join(tmpDir, `${dbId}.sqlite`));
    });

    it('throws NOT_FOUND if vault key is missing', async () => {
        mockVault.get!.mockResolvedValueOnce(undefined);

        await expect(provisioner.getCredentials('ws-1', 'db_nonexistent')).rejects.toThrowError(/Database credentials not found/);
    });
});
