import type { Logger } from '@orch/daemon';
import { DatabaseProvisioner } from '@orch/db-manager';
import Database from 'better-sqlite3-multiple-ciphers';
import { OrchestratorError, ErrorCode } from '@orch/shared';

export class DbHostFunctions {
    constructor(
        private readonly dbProvisioner: DatabaseProvisioner,
        private readonly pluginId: string,
        private readonly permissions: string[],
        private readonly logger: Logger,
        private readonly dbId?: string
    ) {}

    public async query(sql: string, params: any[] = []): Promise<any[]> {
        if (!this.permissions.includes('db:read')) {
            throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, 'Plugin lacks db:read permission');
        }

        if (!this.dbId) {
             throw new OrchestratorError(ErrorCode.INTERNAL_ERROR, 'Plugin has db permission but no DB provisioned');
        }

        const creds = await this.dbProvisioner.getCredentials('plugin-' + this.pluginId, this.dbId);

        try {
            const db = new Database(creds.path, {
                cipher: 'sqlcipher',
                key: creds.key,
            });

            // Execute
            // CAUTION: This allows arbitrary SQL.
            // The plugin is sandboxed, but can it mess up its own DB? Yes.
            // Can it access host files via SQLite exploits?
            // SQLite is generally robust, but we should be careful.
            // better-sqlite3 runs in the host process.

            const stmt = db.prepare(sql);
            // Check if it's a read or write query and enforce permissions further if needed?
            // SQLite prepare doesn't execute.

            if (stmt.reader) {
                 // ok
            } else {
                if (!this.permissions.includes('db:write')) {
                     db.close();
                     throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, 'Plugin lacks db:write permission');
                }
            }

            const result = stmt.reader ? stmt.all(params) : stmt.run(params);
            db.close();

            // If it's a run result, return it differently?
            // The host function signature must be consistent.
            // If we return JSON string, we can handle both.
            return stmt.reader ? (result as any[]) : [{ changes: result.changes, lastInsertRowid: result.lastInsertRowid }];

        } catch (err: any) {
            this.logger.error({ err, sql }, 'Plugin DB query failed');
            throw new OrchestratorError(ErrorCode.DB_ERROR, err.message);
        }
    }
}
