import type { Logger } from '@orch/daemon';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { PluginStore } from '../store.js';

export class SettingsHostFunctions {
    constructor(
        private readonly store: PluginStore,
        private readonly pluginId: string,
        private readonly permissions: string[],
        private readonly logger: Logger
    ) {}

    public get(key: string): string | null {
        if (!this.permissions.includes('settings:read')) {
            throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, 'Plugin lacks settings:read permission');
        }

        try {
            const val = this.store.getSetting(this.pluginId, key);
            return val ?? null;
        } catch (err: unknown) {
            this.logger.error({ err, key }, 'Plugin settings get failed');
            const msg = err instanceof Error ? err.message : String(err);
            throw new OrchestratorError(ErrorCode.INTERNAL_ERROR, msg);
        }
    }

    public set(key: string, value: string): void {
        if (!this.permissions.includes('settings:write')) {
            throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, 'Plugin lacks settings:write permission');
        }

        try {
            this.store.setSetting(this.pluginId, key, value);
        } catch (err: unknown) {
            this.logger.error({ err, key }, 'Plugin settings set failed');
            const msg = err instanceof Error ? err.message : String(err);
            throw new OrchestratorError(ErrorCode.INTERNAL_ERROR, msg);
        }
    }

    public delete(key: string): void {
        if (!this.permissions.includes('settings:write')) {
            throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, 'Plugin lacks settings:write permission');
        }

        try {
            this.store.deleteSetting(this.pluginId, key);
        } catch (err: unknown) {
            this.logger.error({ err, key }, 'Plugin settings delete failed');
            const msg = err instanceof Error ? err.message : String(err);
            throw new OrchestratorError(ErrorCode.INTERNAL_ERROR, msg);
        }
    }
}
