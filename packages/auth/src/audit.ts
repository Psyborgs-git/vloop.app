/**
 * Tamper-evident audit logger.
 *
 * Every mutation is logged with a hash chain linking entries together.
 * Hash chain: each entry's hash = SHA-256(prev_hash + entry_data).
 */

import { createHash } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuditEntry {
    id: number;
    timestamp: string;
    sessionId: string | null;
    identity: string;
    topic: string;
    action: string;
    resource: string | null;
    outcome: 'allowed' | 'denied';
    traceId: string | null;
    entryHash: string;
}

export interface AuditQueryOptions {
    from?: string;
    to?: string;
    identity?: string;
    topic?: string;
    outcome?: 'allowed' | 'denied';
    limit?: number;
    offset?: number;
}

// ─── Implementation ─────────────────────────────────────────────────────────

export class AuditLogger {
    private db: BetterSqlite3.Database;
    private lastHash: string = '0'.repeat(64); // Genesis hash

    constructor(db: BetterSqlite3.Database) {
        this.db = db;
        this.initSchema();
        this.loadLastHash();
    }

    private initSchema(): void {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp   TEXT NOT NULL,
        session_id  TEXT,
        identity    TEXT NOT NULL,
        topic       TEXT NOT NULL,
        action      TEXT NOT NULL,
        resource    TEXT,
        outcome     TEXT NOT NULL,
        trace_id    TEXT,
        prev_hash   TEXT NOT NULL,
        entry_hash  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_identity ON audit_log(identity);
    `);
    }

    private loadLastHash(): void {
        const row = this.db.prepare(
            'SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1',
        ).get() as { entry_hash: string } | undefined;

        if (row) {
            this.lastHash = row.entry_hash;
        }
    }

    /**
     * Log a mutation event.
     */
    log(entry: {
        sessionId?: string;
        identity: string;
        topic: string;
        action: string;
        resource?: string;
        outcome: 'allowed' | 'denied';
        traceId?: string;
    }): void {
        const timestamp = new Date().toISOString();
        const prevHash = this.lastHash;

        // Compute hash chain
        const data = `${prevHash}|${timestamp}|${entry.identity}|${entry.topic}|${entry.action}|${entry.resource ?? ''}|${entry.outcome}`;
        const entryHash = createHash('sha256').update(data).digest('hex');

        this.db.prepare(`
      INSERT INTO audit_log (timestamp, session_id, identity, topic, action, resource, outcome, trace_id, prev_hash, entry_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            timestamp,
            entry.sessionId ?? null,
            entry.identity,
            entry.topic,
            entry.action,
            entry.resource ?? null,
            entry.outcome,
            entry.traceId ?? null,
            prevHash,
            entryHash,
        );

        this.lastHash = entryHash;
    }

    /**
     * Query audit log with filters.
     */
    query(options: AuditQueryOptions = {}): AuditEntry[] {
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (options.from) {
            conditions.push('timestamp >= ?');
            params.push(options.from);
        }
        if (options.to) {
            conditions.push('timestamp <= ?');
            params.push(options.to);
        }
        if (options.identity) {
            conditions.push('identity = ?');
            params.push(options.identity);
        }
        if (options.topic) {
            conditions.push('topic = ?');
            params.push(options.topic);
        }
        if (options.outcome) {
            conditions.push('outcome = ?');
            params.push(options.outcome);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = options.limit ?? 100;
        const offset = options.offset ?? 0;

        const rows = this.db.prepare(
            `SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
        ).all(...params, limit, offset) as Array<{
            id: number;
            timestamp: string;
            session_id: string | null;
            identity: string;
            topic: string;
            action: string;
            resource: string | null;
            outcome: string;
            trace_id: string | null;
            entry_hash: string;
        }>;

        return rows.map((row) => ({
            id: row.id,
            timestamp: row.timestamp,
            sessionId: row.session_id,
            identity: row.identity,
            topic: row.topic,
            action: row.action,
            resource: row.resource,
            outcome: row.outcome as 'allowed' | 'denied',
            traceId: row.trace_id,
            entryHash: row.entry_hash,
        }));
    }
}
