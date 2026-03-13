/**
 * Gateway middleware — RBAC permission checking and rate limiting.
 *
 * The gateway is the single enforcement point. No service handles
 * authentication — they trust the gateway to have already validated
 * the JWT, checked RBAC, and enriched the event with userId + roles.
 */

import { minimatch } from 'minimatch';
import { DEFAULT_ROLES } from '@orch/event-contracts';
import type { RolePermissions } from '@orch/event-contracts';

// ─── RBAC ───────────────────────────────────────────────────────────────────

/**
 * Evaluate whether a set of roles grants permission for a {service}:{action} pair.
 *
 * The algorithm:
 *   1. For each role the user holds, check the deny list first.
 *   2. If any deny pattern matches, immediately deny.
 *   3. Then check the allow list — if any allow pattern matches, grant.
 *   4. If no role grants access, deny.
 *
 * @param roles       - Roles assigned to the user session.
 * @param service     - Target service name (e.g. "terminal").
 * @param action      - Requested action (e.g. "exec").
 * @param roleStore   - Role definitions (defaults to DEFAULT_ROLES).
 * @returns true if allowed, false if denied.
 */
export function checkPermission(
    roles: string[],
    service: string,
    action: string,
    roleStore: Record<string, RolePermissions> = DEFAULT_ROLES,
): boolean {
    const requested = `${service}:${action}`;

    for (const roleName of roles) {
        const role = roleStore[roleName];
        if (!role) continue;

        // Check deny list first — explicit deny wins
        for (const pattern of role.deny) {
            if (pattern === requested || minimatch(requested, pattern)) {
                return false;
            }
        }

        // Check allow list
        for (const pattern of role.permissions) {
            if (pattern === '*' || pattern === requested || minimatch(requested, pattern)) {
                return true;
            }
        }
    }

    return false;
}

// ─── Rate Limiting ──────────────────────────────────────────────────────────

/**
 * In-memory token-bucket rate limiter.
 *
 * Each userId gets a bucket that refills at `refillRate` tokens/second
 * up to `maxTokens`. Each request consumes one token.
 *
 * For production horizontal scaling, move the bucket state to Redis
 * using a Lua script for atomic decrement-and-check.
 */
export class RateLimiter {
    private buckets = new Map<string, { tokens: number; lastRefill: number }>();

    constructor(
        private readonly maxTokens: number = 60,
        private readonly refillRate: number = 10,
    ) {}

    /**
     * Check whether a request from `userId` is allowed.
     * Consumes one token if allowed.
     * Returns true if allowed, false if rate-limited.
     */
    consume(userId: string): boolean {
        const now = Date.now();
        let bucket = this.buckets.get(userId);

        if (!bucket) {
            bucket = { tokens: this.maxTokens, lastRefill: now };
            this.buckets.set(userId, bucket);
        }

        // Refill tokens based on elapsed time
        const elapsed = (now - bucket.lastRefill) / 1000;
        bucket.tokens = Math.min(this.maxTokens, bucket.tokens + elapsed * this.refillRate);
        bucket.lastRefill = now;

        if (bucket.tokens < 1) return false;

        bucket.tokens -= 1;
        return true;
    }

    /**
     * Reset all rate-limit buckets.
     */
    reset(): void {
        this.buckets.clear();
    }
}
