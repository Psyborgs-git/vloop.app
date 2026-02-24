import { ErrorCode, OrchestratorError } from '@orch/shared';
import type { HandlerContext } from '@orch/daemon';
import type { DatabaseProvisioner } from './provisioner.js';
import type { DatabasePool } from './pooler.js';
import type { ExternalDatabaseRegistry } from './external-db.js';
import type { DatabaseManager } from '@orch/shared/db';

export function createDatabaseHandler(
    provisioner: DatabaseProvisioner,
    pool: DatabasePool,
    rootDb?: DatabaseManager,
    externalRegistry?: ExternalDatabaseRegistry,
) {
    return async function databaseHandler(action: string, payload: unknown, ctx: HandlerContext) {
        const p = payload as Record<string, unknown>;

        switch (action) {
            // ── Internal provisioned DBs ─────────────────────────────────
            case 'db.provision': {
                const workspaceId = requireString(p, 'workspaceId');
                const description = typeof p['description'] === 'string' ? p['description'] : undefined;
                return provisioner.provision({ workspaceId, description });
            }

            case 'db.query': {
                const workspaceId = requireString(p, 'workspaceId');
                const dbId = requireString(p, 'dbId');
                const sql = requireString(p, 'sql');
                const params = Array.isArray(p['params']) ? p['params'] : [];
                return pool.executeRaw(workspaceId, dbId, sql, params);
            }

            case 'db.disconnect': {
                const workspaceId = requireString(p, 'workspaceId');
                const dbId = requireString(p, 'dbId');
                pool.disconnect(workspaceId, dbId);
                return { success: true };
            }

            // ── Root DB access (admin only) ──────────────────────────────
            case 'db.root_query': {
                if (!rootDb) {
                    throw new OrchestratorError(ErrorCode.SERVICE_UNAVAILABLE, 'Root database is not available');
                }
                if (!ctx.roles?.includes('admin')) {
                    throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, 'Root database access is restricted to admin role');
                }

                const sql = requireString(p, 'sql');
                const params = Array.isArray(p['params']) ? p['params'] : [];

                try {
                    const db = rootDb.getDb();
                    const stmt = db.prepare(sql);
                    if (stmt.reader) {
                        const rows = stmt.all(...params);
                        return { rows };
                    } else {
                        const info = stmt.run(...params);
                        return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
                    }
                } catch (err: any) {
                    throw new OrchestratorError(ErrorCode.DB_ERROR, `Root query failed: ${err.message}`);
                }
            }

            // ── External database management ─────────────────────────────
            case 'db.ext.register': {
                if (!externalRegistry) {
                    throw new OrchestratorError(ErrorCode.SERVICE_UNAVAILABLE, 'External database registry not available');
                }
                const identity = requireIdentity(ctx);
                return externalRegistry.register(identity, {
                    label: requireString(p, 'label'),
                    dbType: requireString(p, 'dbType') as any,
                    host: typeof p['host'] === 'string' ? p['host'] : undefined,
                    port: typeof p['port'] === 'number' ? p['port'] : undefined,
                    databaseName: typeof p['databaseName'] === 'string' ? p['databaseName'] : undefined,
                    ssl: p['ssl'] === true,
                    username: typeof p['username'] === 'string' ? p['username'] : undefined,
                    password: typeof p['password'] === 'string' ? p['password'] : undefined,
                    filePath: typeof p['filePath'] === 'string' ? p['filePath'] : undefined,
                });
            }

            case 'db.ext.list': {
                if (!externalRegistry) {
                    throw new OrchestratorError(ErrorCode.SERVICE_UNAVAILABLE, 'External database registry not available');
                }
                const identity = requireIdentity(ctx);
                return { databases: externalRegistry.list(identity, ctx.roles ?? []) };
            }

            case 'db.ext.query': {
                if (!externalRegistry) {
                    throw new OrchestratorError(ErrorCode.SERVICE_UNAVAILABLE, 'External database registry not available');
                }
                const identity = requireIdentity(ctx);
                const id = requireString(p, 'id');
                const sql = requireString(p, 'sql');
                const params = Array.isArray(p['params']) ? p['params'] : [];
                return externalRegistry.query(id, identity, ctx.roles ?? [], sql, params);
            }

            case 'db.ext.test': {
                if (!externalRegistry) {
                    throw new OrchestratorError(ErrorCode.SERVICE_UNAVAILABLE, 'External database registry not available');
                }
                const identity = requireIdentity(ctx);
                const id = requireString(p, 'id');
                return externalRegistry.testConnection(id, identity, ctx.roles ?? []);
            }

            case 'db.ext.remove': {
                if (!externalRegistry) {
                    throw new OrchestratorError(ErrorCode.SERVICE_UNAVAILABLE, 'External database registry not available');
                }
                const identity = requireIdentity(ctx);
                const id = requireString(p, 'id');
                await externalRegistry.remove(id, identity, ctx.roles ?? []);
                return { success: true };
            }

            default:
                throw new OrchestratorError(ErrorCode.UNKNOWN_ACTION, `Unknown action: ${action}`);
        }
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requireString(obj: Record<string, unknown>, key: string): string {
    const val = obj[key];
    if (typeof val !== 'string' || val.length === 0) {
        throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, `Missing or invalid required field: "${key}"`);
    }
    return val;
}

function requireIdentity(ctx: HandlerContext): string {
    if (!ctx.identity) {
        throw new OrchestratorError(ErrorCode.AUTH_REQUIRED, 'Authentication required');
    }
    return ctx.identity;
}
