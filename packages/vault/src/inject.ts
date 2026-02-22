/**
 * Secret injection — resolves ${vault:secret_name} templates in env configs.
 */

import type { VaultStore } from './store.js';

const VAULT_REF_PATTERN = /\$\{vault:([^}]+)\}/g;

export class SecretInjector {
    private store: VaultStore;

    constructor(store: VaultStore) {
        this.store = store;
    }

    /**
     * Resolve all ${vault:secret_name} references in a string value.
     */
    resolveString(value: string): string {
        return value.replace(VAULT_REF_PATTERN, (_match, secretName: string) => {
            const secret = this.store.get(secretName);
            return secret.value;
        });
    }

    /**
     * Resolve all vault references in an env var map.
     * Returns a new map with resolved values.
     */
    resolveEnvMap(env: Record<string, string>): Record<string, string> {
        const resolved: Record<string, string> = {};

        for (const [key, value] of Object.entries(env)) {
            resolved[key] = this.resolveString(value);
        }

        return resolved;
    }

    /**
     * Check if a string contains vault references.
     */
    hasReferences(value: string): boolean {
        return VAULT_REF_PATTERN.test(value);
    }
}
