/**
 * Tamper-evident audit logger.
 *
 * Every mutation is logged with a hash chain linking entries together.
 * Hash chain: each entry's hash = SHA-256(prev_hash + entry_data).
 */

import { createHash } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';
import type { RootDatabaseOrm } from '@orch/shared/db';
import type { PaginationOptions, PaginatedResult } from '@orch/shared';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const auditLogTable = sqliteTable('audit_log', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    timestamp: text('timestamp').notNull(),
    session_id: text('session_id'),
    identity: text('identity').notNull(),
    topic: text('topic').notNull(),
    action: text('action').notNull(),
    resource: text('resource'),
    outcome: text('outcome').notNull(),
    trace_id: text('trace_id'),
    prev_hash: text('prev_hash').notNull(),
    entry_hash: text('entry_hash').notNull(),
});

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

export interface AuditQueryOptions extends PaginationOptions {
    from?: string;
    to?: string;
    identity?: string;
    topic?: string;
    outcome?: 'allowed' | 'denied';
}

// ─── Implementation ─────────────────────────────────────────────────────────

export class AuditLogger {
    private db: BetterSqlite3.Database;
    private orm: RootDatabaseOrm;
    private lastHash: string = '0'.repeat(64); // Genesis hash

    constructor(db: BetterSqlite3.Database, orm: RootDatabaseOrm) {
        this.db = db;
        this.orm = orm;
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
        const row = this.orm
            .select({ entry_hash: auditLogTable.entry_hash })
            .from(auditLogTable)
            .orderBy(desc(auditLogTable.id))
            .limit(1)
            .get() as { entry_hash: string } | undefined;

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

        this.orm
            .insert(auditLogTable)
            .values({
                timestamp,
                session_id: entry.sessionId ?? null,
                identity: entry.identity,
                topic: entry.topic,
                action: entry.action,
                resource: entry.resource ?? null,
                outcome: entry.outcome,
                trace_id: entry.traceId ?? null,
                prev_hash: prevHash,
                entry_hash: entryHash,
            })
            .run();

        this.lastHash = entryHash;
    }

    /**
     * Query audit log with filters.
     */
    query(options: AuditQueryOptions = {}): PaginatedResult<AuditEntry> {
        const whereClauses: any[] = [];
        if (options.from) {
            whereClauses.push(gte(auditLogTable.timestamp, options.from));
        }
        if (options.to) {
            whereClauses.push(lte(auditLogTable.timestamp, options.to));
        }
        if (options.identity) {
            whereClauses.push(eq(auditLogTable.identity, options.identity));
        }
        if (options.topic) {
            whereClauses.push(eq(auditLogTable.topic, options.topic));
        }
        if (options.outcome) {
            whereClauses.push(eq(auditLogTable.outcome, options.outcome));
        }
        const whereClause = whereClauses.length > 0 ? and(...whereClauses) : undefined;

        const defaultLimit = 100;
        const defaultOffset = 0;
        const rawLimit = options.limit;
        const rawOffset = options.offset;
        const limit =
            Number.isFinite(rawLimit as number) && (rawLimit as number) >= 0
                ? Math.trunc(rawLimit as number)
                : defaultLimit;
        const offset =
            Number.isFinite(rawOffset as number) && (rawOffset as number) >= 0
                ? Math.trunc(rawOffset as number)
                : defaultOffset;

        const countQuery = this.orm
            .select({ count: sql<number>`count(*)` })
            .from(auditLogTable);
        const countRow = whereClause
            ? countQuery.where(whereClause).get() as { count: number } | undefined
            : countQuery.get() as { count: number } | undefined;
        const total = countRow?.count ?? 0;

        const rowsQuery = this.orm
            .select()
            .from(auditLogTable)
            .orderBy(desc(auditLogTable.id))
            .limit(limit)
            .offset(offset);
        const rows = (whereClause
            ? rowsQuery.where(whereClause).all()
            : rowsQuery.all()) as Array<{
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

        const items = rows.map((row) => ({
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

        return { items, total, limit, offset };
    }
}
