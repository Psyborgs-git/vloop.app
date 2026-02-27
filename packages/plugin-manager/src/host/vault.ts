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

    public async read(key: string): Promise<string | null> {
        // Enforce permission: vault:read:<key> or vault:read:*
        if (!this.hasPermission('read', key)) {
            this.logger.warn({ pluginId: this.pluginId, key }, 'Plugin denied vault read access');
            throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, `Plugin denied read access to vault key: ${key}`);
        }

        try {
            const secret = this.vaultStore.get(key);
            return secret ? secret.value : null;
        } catch (err: any) {
            if (err.code === ErrorCode.SECRET_NOT_FOUND) {
                return null;
            }
            throw err;
        }
    }

    public async write(key: string, value: string): Promise<void> {
        // Enforce permission: vault:write:<key> or vault:write:*
        if (!this.hasPermission('write', key)) {
            this.logger.warn({ pluginId: this.pluginId, key }, 'Plugin denied vault write access');
            throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, `Plugin denied write access to vault key: ${key}`);
        }

        try {
            // Check if exists to decide create vs update
            try {
                this.vaultStore.update(key, value, { pluginId: this.pluginId }, { identity: `plugin:${this.pluginId}`, roles: [] });
            } catch (e: any) {
                if (e.code === ErrorCode.SECRET_NOT_FOUND) {
                     this.vaultStore.create(key, value, { pluginId: this.pluginId }, `plugin:${this.pluginId}`);
                } else {
                    throw e;
                }
            }
        } catch (err: any) {
             this.logger.error({ err, key }, 'Plugin vault write failed');
             throw new OrchestratorError(ErrorCode.INTERNAL_ERROR, err.message);
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
