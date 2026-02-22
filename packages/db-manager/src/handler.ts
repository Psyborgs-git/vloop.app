import { ErrorCode, OrchestratorError } from '@orch/shared';
import type { HandlerContext } from '@orch/daemon';
import type { DatabaseProvisioner } from './provisioner.js';
import type { DatabasePool } from './pooler.js';

export function createDatabaseHandler(provisioner: DatabaseProvisioner, pool: DatabasePool) {
    return async function databaseHandler(action: string, payload: unknown, _ctx: HandlerContext) {
        switch (action) {
            case 'db.provision': {
                const req = payload as { workspaceId: string; description?: string };
                if (!req.workspaceId) throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'workspaceId is required');

                const result = await provisioner.provision(req);
                return result;
            }

            case 'db.query': {
                const req = payload as { workspaceId: string; dbId: string; sql: string; params?: any[] };
                if (!req.workspaceId || !req.dbId || !req.sql) {
                    throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'workspaceId, dbId, and sql are required');
                }

                const result = await pool.executeRaw(req.workspaceId, req.dbId, req.sql, req.params ?? []);
                return result;
            }

            case 'db.disconnect': {
                const req = payload as { workspaceId: string; dbId: string };
                if (!req.workspaceId || !req.dbId) {
                    throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'workspaceId and dbId are required');
                }

                pool.disconnect(req.workspaceId, req.dbId);
                return { success: true };
            }

            default:
                throw new OrchestratorError(ErrorCode.UNKNOWN_ACTION, `Unknown action: ${action}`);
        }
    };
}
