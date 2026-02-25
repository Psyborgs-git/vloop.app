/**
 * Terminal session persistence.
 *
 * Maintains a `terminal_sessions` table that records metadata for
 * each PTY session: who ran it, which shell, the on-disk log path,
 * start/end timestamps, and the exit code.  This lets the backend
 * answer "show me my old terminal sessions" without having to scan
 * the file-system.
 */

import type { DatabaseManager } from '@orch/shared/db';
import type { Logger } from '@orch/daemon';

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
    private readonly db: ReturnType<DatabaseManager['open']>;
    private readonly logger: Logger;

    constructor(db: ReturnType<DatabaseManager['open']>, logger: Logger) {
        this.db = db;
        this.logger = logger.child({ component: 'terminal-session-store' });
        this.migrate();
    }

    private migrate(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS terminal_sessions (
                id          TEXT PRIMARY KEY,
                owner       TEXT NOT NULL,
                shell       TEXT NOT NULL DEFAULT '',
                cwd         TEXT NOT NULL DEFAULT '',
                cols        INTEGER NOT NULL DEFAULT 80,
                rows        INTEGER NOT NULL DEFAULT 24,
                profile_id  TEXT,
                log_path    TEXT,
                started_at  TEXT NOT NULL,
                ended_at    TEXT,
                exit_code   INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_terminal_sessions_owner
                ON terminal_sessions(owner);
            CREATE INDEX IF NOT EXISTS idx_terminal_sessions_started
                ON terminal_sessions(started_at DESC);
        `);
        this.logger.debug('Terminal sessions table migrated');
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
        this.db.prepare(`
            INSERT INTO terminal_sessions
                (id, owner, shell, cwd, cols, rows, profile_id, log_path, started_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            input.id,
            input.owner,
            input.shell,
            input.cwd,
            input.cols,
            input.rows,
            input.profileId ?? null,
            input.logPath ?? null,
            new Date().toISOString(),
        );
        this.logger.debug({ id: input.id }, 'Terminal session record created');
    }

    /** Mark a session as ended and record its exit code. */
    end(id: string, exitCode: number | null): void {
        this.db.prepare(`
            UPDATE terminal_sessions
            SET ended_at = ?, exit_code = ?
            WHERE id = ?
        `).run(new Date().toISOString(), exitCode ?? null, id);
        this.logger.debug({ id, exitCode }, 'Terminal session record closed');
    }

    /** Retrieve a single session record. */
    get(id: string): TerminalSessionRecord | undefined {
        const row = this.db.prepare(
            'SELECT * FROM terminal_sessions WHERE id = ?',
        ).get(id) as any;
        return row ? this.toRecord(row) : undefined;
    }

    /**
     * List session records, most-recent first.
     * Admins can pass `undefined` to list all; others should pass their identity.
     */
    list(owner?: string, limit = 100): TerminalSessionRecord[] {
        const rows = owner
            ? (this.db.prepare(
                'SELECT * FROM terminal_sessions WHERE owner = ? ORDER BY started_at DESC LIMIT ?',
            ).all(owner, limit) as any[])
            : (this.db.prepare(
                'SELECT * FROM terminal_sessions ORDER BY started_at DESC LIMIT ?',
            ).all(limit) as any[]);
        return rows.map((r) => this.toRecord(r));
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
