/**
 * RBAC Policy Engine.
 *
 * Loads role definitions from a TOML file and evaluates permissions
 * using the format: topic:action:resource with glob matching.
 */

import { readFileSync } from 'node:fs';
import { parse as parseTOML } from 'smol-toml';
import { minimatch } from 'minimatch';
import { OrchestratorError, ErrorCode } from '@orch/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RoleDefinition {
    description: string;
    permissions: string[];
}

export interface RbacPolicy {
    roles: Record<string, RoleDefinition>;
}

interface ParsedPermission {
    topicPattern: string;
    actionPattern: string;
    resourcePattern: string;
}

// ─── Implementation ─────────────────────────────────────────────────────────

export class PolicyEngine {
    private roles = new Map<string, ParsedPermission[]>();

    /**
     * Load policies from a TOML file.
     */
    load(policyPath: string): void {
        try {
            const content = readFileSync(policyPath, 'utf-8');
            const parsed = parseTOML(content) as unknown as RbacPolicy;

            this.roles.clear();

            for (const [roleName, roleDef] of Object.entries(parsed.roles)) {
                const permissions = roleDef.permissions.map((p) => this.parsePermission(p));
                this.roles.set(roleName, permissions);
            }
        } catch (err) {
            if (err instanceof OrchestratorError) throw err;
            throw new OrchestratorError(
                ErrorCode.CONFIG_INVALID,
                `Failed to load RBAC policies: ${err instanceof Error ? err.message : String(err)}`,
                { path: policyPath },
            );
        }
    }

    /**
     * Evaluate whether a set of roles grants permission for a given action.
     *
     * @param roles - The roles assigned to the session.
     * @param topic - The message topic (e.g., "container").
     * @param action - The message action (e.g., "create").
     * @param resource - The target resource (e.g., "agent-llm-1"). Defaults to "*".
     * @returns true if allowed, false if denied.
     */
    evaluate(
        roles: string[],
        topic: string,
        action: string,
        resource: string = '*',
    ): boolean {
        for (const role of roles) {
            const permissions = this.roles.get(role);
            if (!permissions) continue;

            for (const perm of permissions) {
                const topicMatch = this.matchGlob(perm.topicPattern, topic);
                const actionMatch = this.matchGlob(perm.actionPattern, action);
                const resourceMatch = this.matchGlob(perm.resourcePattern, resource);

                if (topicMatch && actionMatch && resourceMatch) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Evaluate and throw if denied.
     */
    enforce(
        roles: string[],
        topic: string,
        action: string,
        resource: string = '*',
    ): void {
        if (!this.evaluate(roles, topic, action, resource)) {
            throw new OrchestratorError(
                ErrorCode.PERMISSION_DENIED,
                `Permission denied: requires ${topic}:${action}:${resource}`,
                { roles, topic, action, resource },
            );
        }
    }

    /**
     * Get all role names loaded.
     */
    roleNames(): string[] {
        return Array.from(this.roles.keys());
    }

    /**
     * Reload policies from the same or different path.
     */
    reload(policyPath: string): void {
        this.load(policyPath);
    }

    /**
     * Parse a permission string "topic:action:resource" into parts.
     */
    private parsePermission(permission: string): ParsedPermission {
        const parts = permission.split(':');
        if (parts.length !== 3) {
            throw new OrchestratorError(
                ErrorCode.CONFIG_INVALID,
                `Invalid permission format: "${permission}". Expected "topic:action:resource".`,
            );
        }
        return {
            topicPattern: parts[0]!,
            actionPattern: parts[1]!,
            resourcePattern: parts[2]!,
        };
    }

    /**
     * Match a glob pattern against a value.
     * "*" matches everything.
     */
    private matchGlob(pattern: string, value: string): boolean {
        if (pattern === '*') return true;
        return minimatch(value, pattern);
    }
}
