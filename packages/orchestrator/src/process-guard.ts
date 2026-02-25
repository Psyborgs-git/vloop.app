import { randomUUID } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';
import { OrchestratorError, ErrorCode } from '@orch/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PermissionRequest {
    id: string;
    command: string;
    status: 'pending' | 'approved' | 'denied';
    createdAt: string;
}

export interface AllowedCommand {
    id: string;
    command: string;
    createdAt: string;
}

// ─── ProcessGuard Service ────────────────────────────────────────────────────

export class ProcessGuard {
    constructor(private readonly db: BetterSqlite3.Database) {}

    /**
     * Initialize the database schema for process permissions.
     */
    init(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS process_allowlist (
                id TEXT PRIMARY KEY,
                command TEXT UNIQUE NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS process_permission_requests (
                id TEXT PRIMARY KEY,
                command TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'denied')),
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_permission_requests_status ON process_permission_requests(status);
        `);
    }

    /**
     * Check if a command is allowed.
     * Throws PERMISSION_REQUIRED if not allowed.
     */
    async check(command: string): Promise<void> {
        // 1. Check allowlist
        const allowed = this.db.prepare(
            'SELECT 1 FROM process_allowlist WHERE command = ?'
        ).get(command);

        if (allowed) {
            return;
        }

        // 2. Check for existing pending request
        const pending = this.db.prepare(
            "SELECT id FROM process_permission_requests WHERE command = ? AND status = 'pending'"
        ).get(command) as { id: string } | undefined;

        if (pending) {
            throw new OrchestratorError(
                ErrorCode.PERMISSION_REQUIRED,
                `Permission required for command: "${command}"`,
                { requestId: pending.id, command },
            );
        }

        // 3. Create new pending request
        const requestId = randomUUID();
        const now = new Date().toISOString();

        this.db.prepare(
            'INSERT INTO process_permission_requests (id, command, status, created_at) VALUES (?, ?, ?, ?)'
        ).run(requestId, command, 'pending', now);

        throw new OrchestratorError(
            ErrorCode.PERMISSION_REQUIRED,
            `Permission required for command: "${command}"`,
            { requestId, command },
        );
    }

    /**
     * Approve a pending request.
     */
    approve(requestId: string): void {
        const req = this.db.prepare(
            'SELECT command FROM process_permission_requests WHERE id = ?'
        ).get(requestId) as { command: string } | undefined;

        if (!req) {
            throw new OrchestratorError(
                ErrorCode.NOT_FOUND,
                `Request not found: ${requestId}`,
                { requestId },
            );
        }

        const now = new Date().toISOString();

        this.db.transaction(() => {
            // Update request status
            this.db.prepare(
                "UPDATE process_permission_requests SET status = 'approved' WHERE id = ?"
            ).run(requestId);

            // Add to allowlist
            this.db.prepare(
                'INSERT OR IGNORE INTO process_allowlist (id, command, created_at) VALUES (?, ?, ?)'
            ).run(randomUUID(), req.command, now);
        })();
    }

    /**
     * Deny a pending request.
     */
    deny(requestId: string): void {
        const result = this.db.prepare(
            "UPDATE process_permission_requests SET status = 'denied' WHERE id = ?"
        ).run(requestId);

        if (result.changes === 0) {
            throw new OrchestratorError(
                ErrorCode.NOT_FOUND,
                `Request not found: ${requestId}`,
                { requestId },
            );
        }
    }

    /**
     * Manually add a command to the allowlist.
     */
    add(command: string): void {
        const now = new Date().toISOString();
        this.db.prepare(
            'INSERT OR IGNORE INTO process_allowlist (id, command, created_at) VALUES (?, ?, ?)'
        ).run(randomUUID(), command, now);
    }

    /**
     * Manually remove a command from the allowlist.
     */
    remove(command: string): void {
        this.db.prepare(
            'DELETE FROM process_allowlist WHERE command = ?'
        ).run(command);
    }

    /**
     * List all pending requests.
     */
    listPending(): PermissionRequest[] {
        const rows = this.db.prepare(
            "SELECT * FROM process_permission_requests WHERE status = 'pending' ORDER BY created_at ASC"
        ).all() as any[];

        return rows.map((r) => ({
            id: r.id,
            command: r.command,
            status: r.status,
            createdAt: r.created_at,
        }));
    }

    /**
     * List all allowed commands.
     */
    listAllowlist(): AllowedCommand[] {
        const rows = this.db.prepare(
            'SELECT * FROM process_allowlist ORDER BY created_at DESC'
        ).all() as any[];

        return rows.map((r) => ({
            id: r.id,
            command: r.command,
            createdAt: r.created_at,
        }));
    }
}
