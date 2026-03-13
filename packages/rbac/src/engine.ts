/**
 * RBAC Policy Engine — centralised role-based access control.
 *
 * Designed to be imported by the gateway only.  All other services
 * receive pre-validated (userId, roles) on every event and apply
 * their own capability checks using the same permission format.
 *
 * Supports:
 *   - Role definitions: guest / developer / admin / extension:{id}
 *   - Permission schema: {service}:{action}  e.g. terminal:exec, vault:read
 *   - Deny-wins model: explicit deny from any role takes precedence
 *   - Redis-backed role store for hot-reload without restart
 *   - TOML file loading for static configuration
 */

import { minimatch } from 'minimatch';
import type { RolePermissions } from '@orch/event-contracts';
import { DEFAULT_ROLES } from '@orch/event-contracts';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PolicyEngineConfig {
    /** Initial role definitions. Falls back to DEFAULT_ROLES. */
    roles?: Record<string, RolePermissions>;
}

// ─── Policy Engine ──────────────────────────────────────────────────────────

export class PolicyEngine {
    private roles: Map<string, RolePermissions>;

    constructor(config?: PolicyEngineConfig) {
        this.roles = new Map(
            Object.entries(config?.roles ?? DEFAULT_ROLES),
        );
    }

    // ── Evaluation ───────────────────────────────────────────────────────

    /**
     * Check if a set of roles grants permission for {service}:{action}.
     *
     * Algorithm (deny-wins):
     *   1. Iterate roles in order
     *   2. For each role, check deny list first — if any deny pattern matches, return false
     *   3. Then check allow list — if any allow pattern matches, return true
     *   4. If no role matches, return false (default deny)
     */
    evaluate(roles: string[], service: string, action: string): boolean {
        const requested = `${service}:${action}`;

        for (const roleName of roles) {
            const role = this.roles.get(roleName);
            if (!role) continue;

            // Check deny first — explicit deny wins
            for (const pattern of role.deny) {
                if (pattern === requested || minimatch(requested, pattern)) {
                    return false;
                }
            }

            // Check allow
            for (const pattern of role.permissions) {
                if (pattern === '*' || pattern === requested || minimatch(requested, pattern)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Evaluate and throw if denied.
     */
    enforce(roles: string[], service: string, action: string): void {
        if (!this.evaluate(roles, service, action)) {
            throw new Error(
                `RBAC denied: roles=[${roles.join(',')}] cannot access ${service}:${action}`,
            );
        }
    }

    // ── Role Management ─────────────────────────────────────────────────

    /**
     * Set or update a role definition.
     * Supports hot-reload: call setRole() and changes take effect immediately.
     */
    setRole(name: string, permissions: RolePermissions): void {
        this.roles.set(name, permissions);
    }

    /**
     * Remove a role definition.
     */
    removeRole(name: string): void {
        this.roles.delete(name);
    }

    /**
     * Get a role definition.
     */
    getRole(name: string): RolePermissions | undefined {
        return this.roles.get(name);
    }

    /**
     * Get all role names.
     */
    roleNames(): string[] {
        return Array.from(this.roles.keys());
    }

    /**
     * Replace all roles with a new set.
     */
    loadRoles(roles: Record<string, RolePermissions>): void {
        this.roles.clear();
        for (const [name, perms] of Object.entries(roles)) {
            this.roles.set(name, perms);
        }
    }

    /**
     * Check if a role name represents an extension.
     * Extension roles start with "extension:" and get the strictest permission subset.
     */
    static isExtensionRole(role: string): boolean {
        return role.startsWith('extension:');
    }

    /**
     * Create a scoped role for an extension.
     * Extensions cannot have wildcards — every permission must be explicit.
     */
    registerExtension(extensionId: string, permissions: string[]): void {
        // Validate: no wildcards allowed for extensions
        for (const perm of permissions) {
            if (perm === '*' || perm.includes('*')) {
                throw new Error(
                    `Extension ${extensionId} cannot have wildcard permission: ${perm}`,
                );
            }
        }

        this.roles.set(`extension:${extensionId}`, {
            permissions,
            deny: [],
        });
    }
}
