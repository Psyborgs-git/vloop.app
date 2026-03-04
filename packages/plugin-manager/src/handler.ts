import type { AppHandlerContext } from '@orch/shared';
import { PluginManager } from './manager.js';

export function createPluginHandler(pluginManager: PluginManager) {
    return async (action: string, payload: any, context: AppHandlerContext) => {
        // Enforce RBAC for plugin management?
        // Assuming admin for now for management, or specific roles.
        // For public commands like list, maybe looser.

        switch (action) {
            case 'install':
                // payload: { url: string }
                // Returns manifest + permissions request
                // Does NOT commit install yet
                if (!context.roles?.includes('admin')) {
                     throw new Error("Permission denied");
                }
                return await pluginManager.prepareInstall(payload.url);

            case 'grant':
                // payload: { id: string, permissions: string[] }
                if (!context.roles?.includes('admin')) {
                     throw new Error("Permission denied");
                }
                await pluginManager.commitInstall(payload.id, payload.permissions);
                return { success: true, message: `Plugin ${payload.id} installed.` };

            case 'cancel':
                // payload: { id: string }
                // Cleans up a staged plugin that was never granted permissions
                if (!context.roles?.includes('admin')) {
                    throw new Error("Permission denied");
                }
                pluginManager.cancelInstall(payload.id);
                return { success: true };

            case 'list':
                return { items: pluginManager.list() };

            case 'uninstall':
                if (!context.roles?.includes('admin')) {
                     throw new Error("Permission denied");
                }
                await pluginManager.uninstall(payload.id);
                return { success: true };

            default:
                throw new Error(`Unknown plugin action: ${action}`);
        }
    };
}
