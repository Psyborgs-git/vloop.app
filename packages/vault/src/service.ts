/**
 * Vault Service Worker — event-driven adapter for the vault package.
 *
 * Subscribes to `vault:ops` Redis channel and delegates to VaultStore.
 * The vault service is the ONLY process that touches the encrypted data/ directory.
 */

import {
    ServiceWorker,
    CHANNELS,
} from '@orch/event-contracts';
import type { ServiceCommand, RedisLike } from '@orch/event-contracts';
import type { VaultStore } from './store.js';

export interface VaultServiceConfig {
    redis: { subscriber: RedisLike; publisher: RedisLike; store: RedisLike };
    vaultStore: VaultStore;
}

export class VaultServiceWorker extends ServiceWorker {
    private vaultStore: VaultStore;

    constructor(config: VaultServiceConfig) {
        super(
            {
                serviceName: 'vault',
                commandChannel: CHANNELS.VAULT_OPS,
            },
            config.redis,
        );
        this.vaultStore = config.vaultStore;
    }

    protected async handleCommand(command: ServiceCommand): Promise<void> {
        const { action, payload, userId, roles, replyTo, traceId } = command;
        const data = (payload ?? {}) as Record<string, unknown>;
        const requester = { identity: userId, roles };

        let result: unknown;

        switch (action) {
            case 'secret.create': {
                const name = requireString(data, 'name');
                const value = requireString(data, 'value');
                const metadata = data['metadata'] as Record<string, unknown> | undefined;
                result = this.vaultStore.create(name, value, metadata, userId);
                break;
            }
            case 'secret.get': {
                const name = requireString(data, 'name');
                const version = typeof data['version'] === 'number' ? data['version'] : undefined;
                result = this.vaultStore.get(name, version, requester);
                break;
            }
            case 'secret.update': {
                const name = requireString(data, 'name');
                const value = requireString(data, 'value');
                const metadata = data['metadata'] as Record<string, unknown> | undefined;
                result = this.vaultStore.update(name, value, metadata, requester);
                break;
            }
            case 'secret.delete': {
                const name = requireString(data, 'name');
                const hard = data['hard'] === true;
                this.vaultStore.delete(name, hard);
                result = { ok: true };
                break;
            }
            case 'secret.list': {
                const prefix = typeof data['prefix'] === 'string' ? data['prefix'] : undefined;
                const limit = typeof data['limit'] === 'number' ? data['limit'] : undefined;
                const offset = typeof data['offset'] === 'number' ? data['offset'] : undefined;
                result = { secrets: this.vaultStore.list({ prefix, limit, offset, owner: userId, roles }) };
                break;
            }
            default:
                await this.publishError(replyTo, traceId, `Unknown vault action: "${action}"`);
                return;
        }

        await this.publishResult(replyTo, {
            traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: result,
            done: true,
        });
    }
}

function requireString(obj: Record<string, unknown>, key: string): string {
    const val = obj[key];
    if (typeof val !== 'string' || val.length === 0) {
        throw new Error(`Missing or invalid required field: "${key}"`);
    }
    return val;
}
