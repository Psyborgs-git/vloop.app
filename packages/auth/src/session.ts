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
import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';
import { OrchestratorError, ErrorCode, generateSessionId } from '@orch/shared';
import type { SessionId } from '@orch/shared';

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
    private db: BetterSqlite3.Database;
    private options: SessionManagerOptions;

    constructor(db: BetterSqlite3.Database, options: SessionManagerOptions) {
        this.db = db;
        this.options = options;
        this.initSchema();
    }

    private initSchema(): void {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id          TEXT PRIMARY KEY,
        token_hash  TEXT NOT NULL UNIQUE,
        identity    TEXT NOT NULL,
        roles       TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        last_active TEXT NOT NULL,
        expires_at  TEXT NOT NULL,
        conn_meta   TEXT,
        revoked     INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_identity ON sessions(identity);
      CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
    `);
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
        const count = this.db.prepare(
            'SELECT COUNT(*) as cnt FROM sessions WHERE identity = ? AND revoked = 0 AND expires_at > ?',
        ).get(identity, new Date().toISOString()) as { cnt: number } | undefined;

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

        this.db.prepare(`
      INSERT INTO sessions (id, token_hash, identity, roles, created_at, last_active, expires_at, conn_meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            id,
            tokenHash,
            identity,
            JSON.stringify(roles),
            now,
            now,
            expiresAt,
            connMeta ? JSON.stringify(connMeta) : null,
        );

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

        const row = this.db.prepare(
            'SELECT * FROM sessions WHERE token_hash = ? AND revoked = 0',
        ).get(tokenHash) as SessionRow | undefined;

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
        this.db.prepare(
            'UPDATE sessions SET last_active = ? WHERE id = ?',
        ).run(now, row.id);

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

        const result = this.db.prepare(
            'UPDATE sessions SET last_active = ?, expires_at = ? WHERE id = ? AND revoked = 0',
        ).run(now.toISOString(), newExpiresAt, sessionId);

        if (result.changes === 0) {
            throw new OrchestratorError(
                ErrorCode.SESSION_REVOKED,
                'Session not found or has been revoked.',
            );
        }

        const row = this.db.prepare(
            'SELECT * FROM sessions WHERE id = ?',
        ).get(sessionId) as SessionRow;

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
        this.db.prepare(
            'UPDATE sessions SET revoked = 1 WHERE id = ?',
        ).run(sessionId);
    }

    /**
     * List active sessions (admin only).
     */
    listActive(): Session[] {
        const now = new Date().toISOString();
        const rows = this.db.prepare(
            'SELECT * FROM sessions WHERE revoked = 0 AND expires_at > ? ORDER BY last_active DESC',
        ).all(now) as SessionRow[];

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
        const result = this.db.prepare(
            'DELETE FROM sessions WHERE expires_at < ? OR revoked = 1',
        ).run(new Date().toISOString());
        return result.changes;
    }

    private hashToken(token: string): string {
        return createHash('sha256').update(token).digest('hex');
    }
}
