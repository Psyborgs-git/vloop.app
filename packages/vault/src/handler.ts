/**
 * WebSocket topic handler for vault operations.
 *
 * Registers as the "vault" topic on the router.
 * Maps actions to VaultStore methods.
 * Enforces per-user ownership scoping.
 */

import type { TopicHandler, HandlerContext } from '@orch/daemon';
import type { VaultStore } from './store.js';
import { OrchestratorError, ErrorCode } from '@orch/shared';

export function createVaultHandler(store: VaultStore): TopicHandler {
    return async (action: string, payload: unknown, context?: HandlerContext) => {
        const p = payload as Record<string, unknown>;
        const identity = context?.identity ?? '__system__';
        const roles = context?.roles ?? [];
        const requester = { identity, roles };

        switch (action) {
            case 'secret.create': {
                const name = requireString(p, 'name');
                const value = requireString(p, 'value');
                const metadata = p['metadata'] as Record<string, unknown> | undefined;
                // Owner is set to the current user's identity
                return store.create(name, value, metadata, identity);
            }

            case 'secret.get': {
                const name = requireString(p, 'name');
                const version = typeof p['version'] === 'number' ? p['version'] : undefined;
                return store.get(name, version, requester);
            }

            case 'secret.update': {
                const name = requireString(p, 'name');
                const value = requireString(p, 'value');
                const metadata = p['metadata'] as Record<string, unknown> | undefined;
                return store.update(name, value, metadata, requester);
            }

            case 'secret.delete': {
                const name = requireString(p, 'name');
                const hard = p['hard'] === true;
                store.delete(name, hard);
                return { ok: true };
            }

            case 'secret.list': {
                const prefix = typeof p['prefix'] === 'string' ? p['prefix'] : undefined;
                const limit = typeof p['limit'] === 'number' ? p['limit'] : undefined;
                const offset = typeof p['offset'] === 'number' ? p['offset'] : undefined;
                return { secrets: store.list({ prefix, limit, offset, owner: identity, roles }) };
            }

            default:
                throw new OrchestratorError(
                    ErrorCode.UNKNOWN_ACTION,
                    `Unknown vault action: ${action}`,
                    { action, available: ['secret.create', 'secret.get', 'secret.update', 'secret.delete', 'secret.list'] },
                );
        }
    };
}

function requireString(obj: Record<string, unknown>, key: string): string {
    const val = obj[key];
    if (typeof val !== 'string' || val.length === 0) {
        throw new OrchestratorError(
            ErrorCode.MALFORMED_MESSAGE,
            `Missing or invalid required field: "${key}" (expected non-empty string).`,
        );
    }
    return val;
}
