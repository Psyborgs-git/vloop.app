/**
 * Session lifecycle manager backed by encrypted SQLite.
 *
 * Sessions are created on successful authentication and track:
 * - Identity and roles
 * - Creation time, last activity, expiry
 * - Connection metadata
 *
 * Session tokens are hashed (SHA-256) before storage — the raw token
 * is only ever held in-memory and sent to the client.
 */

import { createHash, randomBytes } from 'node:crypto';
import { OrchestratorError, ErrorCode, generateSessionId } from '@orch/shared';
import type { SessionId } from '@orch/shared';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { sessionsTable, initAuthSchema } from './schema.js';
import type { RootDatabaseOrm } from '@orch/shared/db';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SessionManagerOptions {
    /** Idle timeout in seconds (default: 3600). */
    idleTimeoutSecs: number;
    /** Max session lifetime in seconds (default: 86400). */
    maxLifetimeSecs: number;
    /** Max concurrent sessions per identity (default: 10). */
    maxSessionsPerIdentity: number;
}

export interface Session {
    id: SessionId;
    identity: string;
    roles: string[];
    createdAt: string;
    lastActive: string;
    expiresAt: string;
}

interface SessionRow {
    id: string;
    token_hash: string;
    identity: string;
    roles: string;
    created_at: string;
    last_active: string;
    expires_at: string;
    conn_meta: string | null;
    revoked: number;
}

// ─── Implementation ─────────────────────────────────────────────────────────

export class SessionManager {
    private orm: RootDatabaseOrm;
    private options: SessionManagerOptions;

    constructor(db: { exec(sql: string): unknown }, orm: RootDatabaseOrm, options: SessionManagerOptions) {
        initAuthSchema(db);
        this.orm = orm;
        this.options = options;
    }

    /**
     * Create a new session for an authenticated identity.
     *
     * @returns The session and the raw token (to be sent to the client once).
     */
    create(
        identity: string,
        roles: string[],
        connMeta?: Record<string, unknown>,
    ): { session: Session; token: string } {
        // Check max sessions per identity
        const count = this.orm
            .select({ cnt: sql<number>`count(*)` })
            .from(sessionsTable)
            .where(and(eq(sessionsTable.identity, identity), eq(sessionsTable.revoked, 0), gt(sessionsTable.expires_at, new Date().toISOString())))
            .get() as { cnt: number } | undefined;

        if (count && count.cnt >= this.options.maxSessionsPerIdentity) {
            throw new OrchestratorError(
                ErrorCode.MAX_SESSIONS_EXCEEDED,
                `Max concurrent sessions (${this.options.maxSessionsPerIdentity}) exceeded for identity: ${identity}`,
            );
        }

        const id = generateSessionId();
        const token = randomBytes(32).toString('hex');
        const tokenHash = this.hashToken(token);
        const now = new Date().toISOString();
        const expiresAt = new Date(
            Date.now() + this.options.idleTimeoutSecs * 1000,
        ).toISOString();

                this.orm.insert(sessionsTable).values({
                        id,
                        token_hash: tokenHash,
                        identity,
                        roles: JSON.stringify(roles),
                        created_at: now,
                        last_active: now,
                        expires_at: expiresAt,
                        conn_meta: connMeta ? JSON.stringify(connMeta) : null,
                        revoked: 0,
                }).run();

        return {
            session: { id, identity, roles, createdAt: now, lastActive: now, expiresAt },
            token,
        };
    }

    /**
     * Validate a session token and return the session if valid.
     * Updates last_active time.
     */
    validate(token: string): Session {
        const tokenHash = this.hashToken(token);
        const now = new Date().toISOString();

        const row = this.orm
            .select()
            .from(sessionsTable)
            .where(and(eq(sessionsTable.token_hash, tokenHash), eq(sessionsTable.revoked, 0)))
            .get() as SessionRow | undefined;

        if (!row) {
            throw new OrchestratorError(
                ErrorCode.SESSION_REVOKED,
                'Session not found or has been revoked.',
            );
        }

        // Check expiry
        if (new Date(row.expires_at) < new Date()) {
            throw new OrchestratorError(
                ErrorCode.SESSION_EXPIRED,
                'Session has expired.',
                { sessionId: row.id },
            );
        }

        // Check max lifetime
        const maxLifetimeMs = this.options.maxLifetimeSecs * 1000;
        if (Date.now() - new Date(row.created_at).getTime() > maxLifetimeMs) {
            this.revoke(row.id as SessionId);
            throw new OrchestratorError(
                ErrorCode.SESSION_EXPIRED,
                'Session has exceeded maximum lifetime.',
                { sessionId: row.id },
            );
        }

        // Update last_active
        this.orm.update(sessionsTable).set({ last_active: now }).where(eq(sessionsTable.id, row.id)).run();

        return {
            id: row.id as SessionId,
            identity: row.identity,
            roles: JSON.parse(row.roles) as string[],
            createdAt: row.created_at,
            lastActive: now,
            expiresAt: row.expires_at,
        };
    }

    /**
     * Refresh a session — extend idle timeout.
     */
    refresh(sessionId: SessionId): Session {
        const now = new Date();
        const newExpiresAt = new Date(
            now.getTime() + this.options.idleTimeoutSecs * 1000,
        ).toISOString();

        const result = this.orm
            .update(sessionsTable)
            .set({ last_active: now.toISOString(), expires_at: newExpiresAt })
            .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.revoked, 0)))
            .run();

        if (result.changes === 0) {
            throw new OrchestratorError(
                ErrorCode.SESSION_REVOKED,
                'Session not found or has been revoked.',
            );
        }

        const row = this.orm.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId)).get() as SessionRow;

        return {
            id: row.id as SessionId,
            identity: row.identity,
            roles: JSON.parse(row.roles) as string[],
            createdAt: row.created_at,
            lastActive: now.toISOString(),
            expiresAt: newExpiresAt,
        };
    }

    /**
     * Revoke a session immediately.
     */
    revoke(sessionId: SessionId): void {
        this.orm.update(sessionsTable).set({ revoked: 1 }).where(eq(sessionsTable.id, sessionId)).run();
    }

    /**
     * List active sessions (admin only).
     */
    listActive(): Session[] {
        const now = new Date().toISOString();
        const rows = this.orm
            .select()
            .from(sessionsTable)
            .where(and(eq(sessionsTable.revoked, 0), gt(sessionsTable.expires_at, now)))
            .orderBy(desc(sessionsTable.last_active))
            .all() as SessionRow[];

        return rows.map((row) => ({
            id: row.id as SessionId,
            identity: row.identity,
            roles: JSON.parse(row.roles) as string[],
            createdAt: row.created_at,
            lastActive: row.last_active,
            expiresAt: row.expires_at,
        }));
    }

    /**
     * Clean up expired sessions from the database.
     */
    cleanup(): number {
        const now = new Date().toISOString();
        const expiredOrRevoked = this.orm
            .select({ id: sessionsTable.id })
            .from(sessionsTable)
            .where(sql<boolean>`${sessionsTable.expires_at} < ${now} OR ${sessionsTable.revoked} = 1`)
            .all()
            .map((r: { id: string }) => r.id);
        if (expiredOrRevoked.length === 0) {
            return 0;
        }
        const result = this.orm.delete(sessionsTable).where(inArray(sessionsTable.id, expiredOrRevoked)).run();
        return result.changes;
    }

    private hashToken(token: string): string {
        return createHash('sha256').update(token).digest('hex');
    }
}
