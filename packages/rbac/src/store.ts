/**
 * Redis-backed role store for RBAC.
 *
 * Stores role definitions in Redis hash for hot-reload without restart.
 * The PolicyEngine can sync from this store at any time.
 */

import type { Redis } from 'ioredis';
import type { RolePermissions } from '@orch/event-contracts';

const RBAC_ROLES_KEY = 'rbac:roles';

export class RoleStore {
    constructor(private readonly redis: Redis) {}

    /**
     * Store a role definition in Redis.
     */
    async set(name: string, permissions: RolePermissions): Promise<void> {
        await this.redis.hset(RBAC_ROLES_KEY, name, JSON.stringify(permissions));
    }

    /**
     * Get a role definition from Redis.
     */
    async get(name: string): Promise<RolePermissions | null> {
        const raw = await this.redis.hget(RBAC_ROLES_KEY, name);
        if (!raw) return null;
        return JSON.parse(raw) as RolePermissions;
    }

    /**
     * Get all role definitions from Redis.
     */
    async getAll(): Promise<Record<string, RolePermissions>> {
        const raw = await this.redis.hgetall(RBAC_ROLES_KEY);
        const result: Record<string, RolePermissions> = {};
        for (const [name, json] of Object.entries(raw)) {
            result[name] = JSON.parse(json) as RolePermissions;
        }
        return result;
    }

    /**
     * Remove a role definition from Redis.
     */
    async remove(name: string): Promise<void> {
        await this.redis.hdel(RBAC_ROLES_KEY, name);
    }

    /**
     * Sync all roles from Redis into a record suitable for PolicyEngine.loadRoles().
     */
    async sync(): Promise<Record<string, RolePermissions>> {
        return this.getAll();
    }
}
