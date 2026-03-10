/**
 * Persistent token manager backed by encrypted SQLite.
 *
 * Tokens are long-lived, revocable credentials for users and agents.
 * Each token supports:
 * - Custom TTL (or no expiry)
 * - Roles inherited from the issuing identity
 * - Fine-grained scopes (e.g., "mcp:*", "agent:read")
 * - Owner identity and type (user/agent)
 *
 * Token values are hashed (SHA-256) before storage — the raw token
 * is only ever held in memory and returned once at creation time.
 */

import { createHash, randomBytes } from 'node:crypto';
import { OrchestratorError, ErrorCode, generateSessionId } from '@orch/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { tokensTable, initAuthSchema } from './schema.js';
import type { RootDatabaseOrm } from '@orch/shared/db';

// ─── Types ───────────────────────────────────────────────────────────────────

export type TokenType = 'user' | 'agent';

export interface PersistentToken {
    id: string;
    name: string;
    identity: string;
    tokenType: TokenType;
    roles: string[];
    scopes: string[];
    createdAt: string;
    expiresAt: string | null;
    lastUsedAt: string | null;
    revoked: boolean;
}

export interface CreateTokenInput {
    /** Human-readable label for the token. */
    name: string;
    /** The identity this token belongs to. */
    identity: string;
    /** Whether this is a user or agent token. */
    tokenType: TokenType;
    /** Roles assigned to this token. */
    roles: string[];
    /** Fine-grained scopes (e.g., "mcp:*", "agent:read"). */
    scopes: string[];
    /** TTL in seconds. Omit or pass 0 for no expiry. */
    ttlSecs?: number;
}

export interface ValidatedToken {
    id: string;
    identity: string;
    roles: string[];
    scopes: string[];
    tokenType: TokenType;
}

export interface TokenManagerOptions {
    /** Max tokens per identity (default: 50). */
    maxTokensPerIdentity: number;
    /** Default TTL in seconds when none is provided at creation time. 0 or omit = no expiry. */
    defaultTtlSecs?: number;
}

interface TokenRow {
    id: string;
    token_hash: string;
    name: string;
    identity: string;
    token_type: string;
    roles: string;
    scopes: string;
    created_at: string;
    expires_at: string | null;
    last_used_at: string | null;
    revoked: number;
}

// ─── Implementation ─────────────────────────────────────────────────────────

export class TokenManager {
    private orm: RootDatabaseOrm;
    private options: TokenManagerOptions;

    constructor(orm: RootDatabaseOrm, options: TokenManagerOptions) {
        this.orm = orm;
        this.options = options;
    }

    /**
     * Initialize the persistent tokens table.
     * Called during component init phase.
     */
    initSchema(db: { exec(sql: string): unknown }): void {
        initAuthSchema(db);
    }

    /**
     * Create a new persistent token.
     *
     * @returns The token metadata and the raw token value (returned once).
     */
    create(input: CreateTokenInput): { token: PersistentToken; rawToken: string } {
        const { name, identity, tokenType, roles, scopes, ttlSecs } = input;

        // Check max tokens per identity
        const count = this.orm
            .select({ cnt: sql<number>`count(*)` })
            .from(tokensTable)
            .where(and(eq(tokensTable.identity, identity), eq(tokensTable.revoked, 0)))
            .get() as { cnt: number } | undefined;

        if (count && count.cnt >= this.options.maxTokensPerIdentity) {
            throw new OrchestratorError(
                ErrorCode.MAX_TOKENS_EXCEEDED,
                `Maximum tokens (${this.options.maxTokensPerIdentity}) exceeded for identity: ${identity}`,
            );
        }

        const id = generateSessionId();
        const rawToken = `orch_${randomBytes(32).toString('hex')}`;
        const tokenHash = this.hashToken(rawToken);
        const now = new Date().toISOString();
        const effectiveTtl = (ttlSecs && ttlSecs > 0) ? ttlSecs : (this.options.defaultTtlSecs ?? 0);
        const expiresAt = effectiveTtl > 0
            ? new Date(Date.now() + effectiveTtl * 1000).toISOString()
            : null;

        this.orm.insert(tokensTable).values({
            id,
            token_hash: tokenHash,
            name,
            identity,
            token_type: tokenType,
            roles: JSON.stringify(roles),
            scopes: JSON.stringify(scopes),
            created_at: now,
            expires_at: expiresAt,
            last_used_at: null,
            revoked: 0,
        }).run();

        const token: PersistentToken = {
            id,
            name,
            identity,
            tokenType,
            roles,
            scopes,
            createdAt: now,
            expiresAt,
            lastUsedAt: null,
            revoked: false,
        };

        return { token, rawToken };
    }

    /**
     * Validate a persistent token and return its identity context.
     * Updates last_used_at timestamp.
     */
    validate(rawToken: string): ValidatedToken {
        const tokenHash = this.hashToken(rawToken);
        const now = new Date().toISOString();

        const row = this.orm
            .select()
            .from(tokensTable)
            .where(and(eq(tokensTable.token_hash, tokenHash), eq(tokensTable.revoked, 0)))
            .get() as TokenRow | undefined;

        if (!row) {
            throw new OrchestratorError(
                ErrorCode.TOKEN_REVOKED,
                'Token not found or has been revoked.',
            );
        }

        // Check expiry
        if (row.expires_at && new Date(row.expires_at) < new Date()) {
            throw new OrchestratorError(
                ErrorCode.TOKEN_EXPIRED,
                'Token has expired.',
                { tokenId: row.id },
            );
        }

        // Update last_used_at
        this.orm.update(tokensTable)
            .set({ last_used_at: now })
            .where(eq(tokensTable.id, row.id))
            .run();

        return {
            id: row.id,
            identity: row.identity,
            roles: JSON.parse(row.roles) as string[],
            scopes: JSON.parse(row.scopes) as string[],
            tokenType: row.token_type as TokenType,
        };
    }

    /**
     * List tokens for a given identity.
     * Does NOT return token hashes.
     */
    listByIdentity(identity: string): PersistentToken[] {
        const rows = this.orm
            .select()
            .from(tokensTable)
            .where(eq(tokensTable.identity, identity))
            .orderBy(desc(tokensTable.created_at))
            .all() as TokenRow[];

        return rows.map(this.rowToToken);
    }

    /**
     * List all active (non-revoked, non-expired) tokens.
     */
    listActive(): PersistentToken[] {
        const now = new Date().toISOString();
        const rows = this.orm
            .select()
            .from(tokensTable)
            .where(and(
                eq(tokensTable.revoked, 0),
                sql<boolean>`(${tokensTable.expires_at} IS NULL OR ${tokensTable.expires_at} > ${now})`,
            ))
            .orderBy(desc(tokensTable.created_at))
            .all() as TokenRow[];

        return rows.map(this.rowToToken);
    }

    /**
     * Revoke a token immediately by its ID.
     */
    revoke(tokenId: string): void {
        const result = this.orm.update(tokensTable)
            .set({ revoked: 1 })
            .where(eq(tokensTable.id, tokenId))
            .run();

        if (result.changes === 0) {
            throw new OrchestratorError(
                ErrorCode.NOT_FOUND,
                `Token not found: ${tokenId}`,
            );
        }
    }

    /**
     * Revoke all tokens for an identity.
     */
    revokeAllForIdentity(identity: string): number {
        const result = this.orm.update(tokensTable)
            .set({ revoked: 1 })
            .where(and(eq(tokensTable.identity, identity), eq(tokensTable.revoked, 0)))
            .run();
        return result.changes;
    }

    /**
     * Extend the expiry of an existing persistent token.
     * If ttlSecs is omitted the defaultTtlSecs from options is used.
     */
    refresh(tokenId: string, ttlSecs?: number): PersistentToken {
        const effectiveTtl = (ttlSecs && ttlSecs > 0) ? ttlSecs : (this.options.defaultTtlSecs ?? 0);
        if (effectiveTtl <= 0) {
            throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'A TTL must be specified to refresh a token.');
        }

        const newExpiresAt = new Date(Date.now() + effectiveTtl * 1000).toISOString();
        const result = this.orm.update(tokensTable)
            .set({ expires_at: newExpiresAt })
            .where(and(eq(tokensTable.id, tokenId), eq(tokensTable.revoked, 0)))
            .run();

        if (result.changes === 0) {
            throw new OrchestratorError(ErrorCode.NOT_FOUND, `Token not found or already revoked: ${tokenId}`);
        }

        const row = this.orm.select().from(tokensTable).where(eq(tokensTable.id, tokenId)).get() as TokenRow;
        return this.rowToToken(row);
    }

    /**
     * Clean up expired and revoked tokens.
     */
    cleanup(): number {
        const now = new Date().toISOString();
        const result = this.orm.delete(tokensTable)
            .where(sql<boolean>`${tokensTable.revoked} = 1 OR (${tokensTable.expires_at} IS NOT NULL AND ${tokensTable.expires_at} < ${now})`)
            .run();
        return result.changes;
    }

    private hashToken(token: string): string {
        return createHash('sha256').update(token).digest('hex');
    }

    private rowToToken(row: TokenRow): PersistentToken {
        return {
            id: row.id,
            name: row.name,
            identity: row.identity,
            tokenType: row.token_type as TokenType,
            roles: JSON.parse(row.roles) as string[],
            scopes: JSON.parse(row.scopes) as string[],
            createdAt: row.created_at,
            expiresAt: row.expires_at,
            lastUsedAt: row.last_used_at,
            revoked: row.revoked === 1,
        };
    }
}
