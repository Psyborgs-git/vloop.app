import type { Logger } from '@orch/daemon';
import { DatabaseProvisioner } from '@orch/db-manager';
import Database from 'better-sqlite3-multiple-ciphers';
import { OrchestratorError, ErrorCode } from '@orch/shared';

/**
 * Allowed SQLite parameter value types (mirrors better-sqlite3's BindingType).
 * Uint8Array is included to allow BLOB bindings.
 */
export type SqlParam = string | number | bigint | boolean | null | Uint8Array;

/**
 * A single row returned by a plugin DB query.
 * Column values may be any SQLite-native type.
 */
export type SqlRow = Record<string, string | number | bigint | boolean | null | Uint8Array>;

export class DbHostFunctions {
    constructor(
        private readonly dbProvisioner: DatabaseProvisioner,
        private readonly pluginId: string,
        private readonly permissions: string[],
        private readonly logger: Logger,
        private readonly dbId?: string
    ) {}

    public query(sql: string, params: SqlParam[] = []): SqlRow[] {
        if (!this.permissions.includes('db:read')) {
            throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, 'Plugin lacks db:read permission');
        }

        if (!this.dbId) {
             throw new OrchestratorError(ErrorCode.INTERNAL_ERROR, 'Plugin has db permission but no DB provisioned');
        }

        const creds = this.dbProvisioner.getCredentials('plugin-' + this.pluginId, this.dbId);

        let db: InstanceType<typeof Database> | undefined;
        try {
            db = new Database(creds.path);
            db.pragma(`cipher='sqlcipher'`);
            db.pragma(`key='${creds.key}'`);

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
                     throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, 'Plugin lacks db:write permission');
                }
            }

            if (stmt.reader) {
                return stmt.all(params) as SqlRow[];
            }

            const result = stmt.run(params);

            // Normalise write results to the same SqlRow[] shape for a consistent API.
            return [{ changes: result.changes, lastInsertRowid: result.lastInsertRowid }];

        } catch (err: unknown) {
            this.logger.error({ err, sql }, 'Plugin DB query failed');
            const msg = err instanceof Error ? err.message : String(err);
            throw new OrchestratorError(ErrorCode.DB_ERROR, msg);
        } finally {
            db?.close();
        }
    }
}
