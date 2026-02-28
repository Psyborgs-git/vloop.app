import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3-multiple-ciphers';
import { VaultStore } from '@orch/vault';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { Logger } from '@orch/daemon';

export interface ProvisionOptions {
    workspaceId: string;
    description?: string;
}

export interface ProvisionResult {
    dbId: string;
    path: string;
}

export class DatabaseProvisioner {

    /**
     * 
    */
    constructor(
        private readonly dataDir: string,
        private readonly vault: VaultStore,
        private readonly logger: Logger,
    ) {
        if (!existsSync(dataDir)) {
            mkdirSync(dataDir, { recursive: true });
        }
    }

    /**
     * Provisions a new, encrypted SQLite database for a workspace.
     */
    public async provision(opts: ProvisionOptions): Promise<ProvisionResult> {
        const dbId = `db_${randomUUID()}`;
        const dbPath = join(this.dataDir, `${dbId}.sqlite`);

        if (existsSync(dbPath)) {
            throw new OrchestratorError(ErrorCode.ALREADY_EXISTS, `Database file already exists: ${dbPath}`);
        }

        // Generate a cryptographically secure 32-byte key for AES-256
        const rawKey = Buffer.from(randomUUID() + randomUUID()).toString('hex').slice(0, 64);

        // Store the key in the central Vault
        const secretPath = `workspaces/${opts.workspaceId}/databases/${dbId}/key`;
        await this.vault.create(secretPath, rawKey, {
            description: opts.description ?? `Encryption key for DB ${dbId}`,
        });

        // Initialize and encrypt the database
        try {
            const db = new Database(dbPath);
            db.pragma(`cipher='sqlcipher'`);
            db.pragma(`key='${rawKey}'`);

            // Recommend WAL mode for concurrency
            db.pragma('journal_mode = WAL');
            db.pragma('synchronous = NORMAL');
            db.pragma('foreign_keys = ON');

            db.close();

            this.logger.info({ dbId, workspaceId: opts.workspaceId }, 'Provisioned new encrypted database');

            return {
                dbId,
                path: dbPath,
            };
        } catch (err: any) {
            this.logger.error({ err, dbPath, stack: err?.stack }, "Failed to provision encrypted database");
            throw new OrchestratorError(ErrorCode.INTERNAL_ERROR, 'Failed to provision underlying database file', { cause: err });
        }
    }

    /**
     * Retrieves the path and raw encryption key from Vault so that poolers can connect.
     */
    public async getCredentials(workspaceId: string, dbId: string): Promise<{ path: string; key: string }> {
        const secretPath = `workspaces/${workspaceId}/databases/${dbId}/key`;
        const secret = await this.vault.get(secretPath);

        if (!secret) {
            throw new OrchestratorError(ErrorCode.NOT_FOUND, `Database credentials not found for ${dbId}`);
        }

        const dbPath = join(this.dataDir, `${dbId}.sqlite`);
        if (!existsSync(dbPath)) {
            throw new OrchestratorError(ErrorCode.NOT_FOUND, `Database file missing from disk: ${dbPath}`);
        }

        return {
            path: dbPath,
            key: secret.value,
        };
    }
}
