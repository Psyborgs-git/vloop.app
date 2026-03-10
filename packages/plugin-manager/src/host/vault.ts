import type { Logger } from '@orch/daemon';
import { VaultStore } from '@orch/vault';
import { OrchestratorError, ErrorCode } from '@orch/shared';

export class VaultHostFunctions {
    constructor(
        private readonly vaultStore: VaultStore,
        private readonly pluginId: string,
        private readonly permissions: string[],
        private readonly logger: Logger
    ) {}

    public read(key: string): string | null {
        // Enforce permission: vault:read:<key> or vault:read:*
        if (!this.hasPermission('read', key)) {
            this.logger.warn({ pluginId: this.pluginId, key }, 'Plugin denied vault read access');
            throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, `Plugin denied read access to vault key: ${key}`);
        }

        try {
            const secret = this.vaultStore.get(key);
            return secret ? secret.value : null;
        } catch (err: unknown) {
            if (err instanceof OrchestratorError && err.code === ErrorCode.SECRET_NOT_FOUND) {
                return null;
            }
            throw err;
        }
    }

    public write(key: string, value: string): void {
        // Enforce permission: vault:write:<key> or vault:write:*
        if (!this.hasPermission('write', key)) {
            this.logger.warn({ pluginId: this.pluginId, key }, 'Plugin denied vault write access');
            throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, `Plugin denied write access to vault key: ${key}`);
        }

        try {
            // Check if exists to decide create vs update
            try {
                this.vaultStore.update(key, value, { pluginId: this.pluginId }, { identity: `plugin:${this.pluginId}`, roles: [] });
            } catch (e: unknown) {
                if (e instanceof OrchestratorError && e.code === ErrorCode.SECRET_NOT_FOUND) {
                     this.vaultStore.create(key, value, { pluginId: this.pluginId }, `plugin:${this.pluginId}`);
                } else {
                    throw e;
                }
            }
        } catch (err: unknown) {
             this.logger.error({ err, key }, 'Plugin vault write failed');
             const msg = err instanceof Error ? err.message : String(err);
             throw new OrchestratorError(ErrorCode.INTERNAL_ERROR, msg);
        }
    }

    private hasPermission(action: 'read' | 'write', key: string): boolean {
        // Check for exact match or wildcard
        const required = `vault:${action}:${key}`;
        const wildcard = `vault:${action}:*`;

        // Also check if the permission string is a prefix match if we supported that,
        // but for now let's stick to simple glob logic if needed or just exact list.
        // The requirement says "Granular keys".

        return this.permissions.includes(required) || this.permissions.includes(wildcard);
    }
}
