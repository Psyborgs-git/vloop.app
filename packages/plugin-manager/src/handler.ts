import { z } from 'zod';
import type { AppHandlerContext, AppTopicHandler } from '@orch/shared';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import { PluginManager } from './manager.js';

// ─── Payload schemas ──────────────────────────────────────────────────────────

const InstallPayloadSchema = z.object({ url: z.string().min(1) });
const GrantPayloadSchema = z.object({
    id: z.string().min(1),
    permissions: z.array(z.string()),
});
const CancelPayloadSchema = z.object({ id: z.string().min(1) });
const UninstallPayloadSchema = z.object({ id: z.string().min(1) });

// ─── Handler factory ──────────────────────────────────────────────────────────

export function createPluginHandler(pluginManager: PluginManager): AppTopicHandler {
    return async (action: string, payload: unknown, context: AppHandlerContext) => {
        switch (action) {
            case 'install': {
                if (!context.roles?.includes('admin')) {
                    throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, 'Permission denied');
                }
                const { url } = InstallPayloadSchema.parse(payload);
                return await pluginManager.prepareInstall(url);
            }

            case 'grant': {
                if (!context.roles?.includes('admin')) {
                    throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, 'Permission denied');
                }
                const { id, permissions } = GrantPayloadSchema.parse(payload);
                await pluginManager.commitInstall(id, permissions);
                return { success: true, message: `Plugin ${id} installed.` };
            }

            case 'cancel': {
                if (!context.roles?.includes('admin')) {
                    throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, 'Permission denied');
                }
                const { id } = CancelPayloadSchema.parse(payload);
                pluginManager.cancelInstall(id);
                return { success: true };
            }

            case 'list':
                return { items: pluginManager.list() };

            case 'uninstall': {
                if (!context.roles?.includes('admin')) {
                    throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, 'Permission denied');
                }
                const { id } = UninstallPayloadSchema.parse(payload);
                await pluginManager.uninstall(id);
                return { success: true };
            }

            default:
                throw new OrchestratorError(ErrorCode.NOT_FOUND, `Unknown plugin action: ${action}`);
        }
    };
}
