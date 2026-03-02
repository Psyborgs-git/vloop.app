import Database from 'better-sqlite3-multiple-ciphers';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { Logger } from '@orch/daemon';
import type { DatabaseProvisioner } from './provisioner.js';

export interface QueryResult {
    lastInsertRowid?: number | bigint;
    changes?: number;
    rows?: any[];
}

export class DatabasePool {
    private readonly connections = new Map<string, InstanceType<typeof Database>>();

    constructor(
        private readonly provisioner: DatabaseProvisioner,
        private readonly logger: Logger,
    ) { }

    /**
     * Connects to a provisioned DB via Vault credentials.
     * Caches the connection handle.
     */
    public async connect(workspaceId: string, dbId: string): Promise<InstanceType<typeof Database>> {
        const cacheKey = `${workspaceId}:${dbId}`;

        if (this.connections.has(cacheKey)) {
            return this.connections.get(cacheKey)!;
        }

        const creds = await this.provisioner.getCredentials(workspaceId, dbId);

        try {
            const db = new Database(creds.path);
            db.pragma(`cipher='sqlcipher'`);
            db.pragma(`key='${creds.key}'`);

            // Verify unlock by attempting a dummy schema read
            db.pragma('schema_version');

            // Optimize connection
            db.pragma('journal_mode = WAL');
            db.pragma('busy_timeout = 5000'); // Prevent SQLITE_BUSY deadlocks

            this.connections.set(cacheKey, db);
            this.logger.debug({ dbId }, 'Opened database connection');
            return db;
        } catch (err: any) {
            this.logger.error({ err, dbId }, 'Failed to open database connection');
            if (err.message && err.message.includes('file is not a database')) {
                throw new OrchestratorError(ErrorCode.INTERNAL_ERROR, 'Failed to decrypt database - invalid key or file corruption', { cause: err });
            }
            throw new OrchestratorError(ErrorCode.INTERNAL_ERROR, 'Failed to open database', { cause: err });
        }
    }

    /**
     * Closes an active connection.
     */
    public disconnect(workspaceId: string, dbId: string): void {
        const cacheKey = `${workspaceId}:${dbId}`;
        const db = this.connections.get(cacheKey);

        if (db) {
            db.close();
            this.connections.delete(cacheKey);
            this.logger.debug({ dbId }, 'Closed database connection');
        }
    }

    /**
     * Disconnects all pooled connections.
     */
    public shutdownAll(): void {
        for (const [key, db] of this.connections.entries()) {
            try {
                db.close();
            } catch (err) {
                this.logger.warn({ err, key }, 'Error closing database connection during shutdown');
            }
        }
        this.connections.clear();
    }

    /**
     * Executes a raw query strictly using the pooled generic handle.
     */
    public async executeRaw(workspaceId: string, dbId: string, sql: string, params: any[] = []): Promise<QueryResult> {
        const db = await this.connect(workspaceId, dbId);

        try {
            const stmt = db.prepare(sql);

            if (stmt.reader) {
                const rows = stmt.all(...params);
                return { rows };
            } else {
                const info = stmt.run(...params);
                return {
                    changes: info.changes,
                    lastInsertRowid: info.lastInsertRowid,
                };
            }
        } catch (err) {
            throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'Query execution failed', { cause: err });
        }
    }
}
