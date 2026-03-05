/**
 * Terminal session persistence.
 *
 * Maintains a `terminal_sessions` table that records metadata for
 * each PTY session: who ran it, which shell, the on-disk log path,
 * start/end timestamps, and the exit code.  This lets the backend
 * answer "show me my old terminal sessions" without having to scan
 * the file-system.
 */

import type { Logger } from '@orch/daemon';
import type { PaginationOptions, PaginatedResult } from '@orch/shared';
import { desc, eq, sql } from 'drizzle-orm';
import { terminalSessionsTable, initTerminalSchema } from './schema.js';
import type { RootDatabaseOrm } from '@orch/shared/db';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TerminalSessionRecord {
    id: string;
    owner: string;
    shell: string;
    cwd: string;
    cols: number;
    rows: number;
    profileId: string | null;
    logPath: string | null;
    startedAt: string;
    endedAt: string | null;
    exitCode: number | null;
}

// ─── Implementation ─────────────────────────────────────────────────────────

export class TerminalSessionStore {
    private readonly orm: RootDatabaseOrm;
    private readonly logger: Logger;

    constructor(db: { exec(sql: string): unknown }, orm: RootDatabaseOrm, logger: Logger) {
        initTerminalSchema(db);
        this.orm = orm;
        this.logger = logger.child({ component: 'terminal-session-store' });
    }

    /** Insert a new session record at spawn time. */
    create(input: {
        id: string;
        owner: string;
        shell: string;
        cwd: string;
        cols: number;
        rows: number;
        profileId?: string;
        logPath?: string;
    }): void {
        this.orm.insert(terminalSessionsTable).values({
            id: input.id,
            owner: input.owner,
            shell: input.shell,
            cwd: input.cwd,
            cols: input.cols,
            rows: input.rows,
            profile_id: input.profileId ?? null,
            log_path: input.logPath ?? null,
            started_at: new Date().toISOString(),
            ended_at: null,
            exit_code: null,
        }).run();
        this.logger.debug({ id: input.id }, 'Terminal session record created');
    }

    /** Mark a session as ended and record its exit code. */
    end(id: string, exitCode: number | null): void {
        this.orm
            .update(terminalSessionsTable)
            .set({ ended_at: new Date().toISOString(), exit_code: exitCode ?? null })
            .where(eq(terminalSessionsTable.id, id))
            .run();
        this.logger.debug({ id, exitCode }, 'Terminal session record closed');
    }

    /** Retrieve a single session record. */
    get(id: string): TerminalSessionRecord | undefined {
        const row = this.orm
            .select()
            .from(terminalSessionsTable)
            .where(eq(terminalSessionsTable.id, id))
            .get() as any;
        return row ? this.toRecord(row) : undefined;
    }

    /**
     * List session records, most-recent first.
     * Admins can pass `undefined` to list all; others should pass their identity.
     */
    list(owner?: string, options: PaginationOptions = {}): PaginatedResult<TerminalSessionRecord> {
        const rawLimit = (options as any).limit;
        const rawOffset = (options as any).offset;
        const limit = Number.isFinite(rawLimit) && typeof rawLimit === 'number'
            ? Math.max(1, Math.floor(rawLimit))
            : 50;
        const offset = Number.isFinite(rawOffset) && typeof rawOffset === 'number'
            ? Math.max(0, Math.floor(rawOffset))
            : 0;

        const countExpr = this.orm
            .select({ count: sql<number>`count(*)` })
            .from(terminalSessionsTable);
        const total = owner
            ? (countExpr.where(eq(terminalSessionsTable.owner, owner)).get()?.count ?? 0)
            : (countExpr.get()?.count ?? 0);

        const rows = owner
            ? this.orm
                .select()
                .from(terminalSessionsTable)
                .where(eq(terminalSessionsTable.owner, owner))
                .orderBy(desc(terminalSessionsTable.started_at))
                .limit(limit)
                .offset(offset)
                .all() as any[]
            : this.orm
                .select()
                .from(terminalSessionsTable)
                .orderBy(desc(terminalSessionsTable.started_at))
                .limit(limit)
                .offset(offset)
                .all() as any[];
        const items = rows.map((r) => this.toRecord(r));

        return { items, total, limit, offset };
    }

    private toRecord(row: any): TerminalSessionRecord {
        return {
            id: row.id,
            owner: row.owner,
            shell: row.shell,
            cwd: row.cwd,
            cols: row.cols,
            rows: row.rows,
            profileId: row.profile_id ?? null,
            logPath: row.log_path ?? null,
            startedAt: row.started_at,
            endedAt: row.ended_at ?? null,
            exitCode: row.exit_code ?? null,
        };
    }
}
