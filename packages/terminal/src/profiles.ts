/**
 * Terminal profile management.
 *
 * Stores and retrieves shell profiles (shell, cwd, env, etc.)
 * in the orchestrator's SQLite database.
 */

import type { DatabaseManager } from '@orch/shared/db';
import type { Logger } from '@orch/daemon';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TerminalProfile {
    id: string;
    name: string;
    shell: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    startupCommands: string[];
    owner: string;
    isDefault: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface CreateProfileInput {
    name: string;
    shell?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    startupCommands?: string[];
    owner: string;
    isDefault?: boolean;
}

export interface UpdateProfileInput {
    name?: string;
    shell?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    startupCommands?: string[];
    isDefault?: boolean;
}

// ─── Implementation ─────────────────────────────────────────────────────────

export class TerminalProfileManager {
    private readonly db: ReturnType<DatabaseManager['open']>;
    private readonly logger: Logger;

    constructor(db: ReturnType<DatabaseManager['open']>, logger: Logger) {
        this.db = db;
        this.logger = logger.child({ component: 'terminal-profiles' });
        this.migrate();
    }

    /**
     * Create profile table if it doesn't exist.
     */
    private migrate(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS terminal_profiles (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                shell       TEXT NOT NULL DEFAULT '',
                args        TEXT NOT NULL DEFAULT '[]',
                cwd         TEXT NOT NULL DEFAULT '',
                env         TEXT NOT NULL DEFAULT '{}',
                startup_commands TEXT NOT NULL DEFAULT '[]',
                owner       TEXT NOT NULL,
                is_default  INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_terminal_profiles_owner ON terminal_profiles(owner);
        `);
        this.logger.debug('Terminal profiles table migrated');
    }

    /**
     * Create a new terminal profile.
     */
    create(input: CreateProfileInput): TerminalProfile {
        const id = `tp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const now = new Date().toISOString();

        // If setting as default, clear existing default for this owner
        if (input.isDefault) {
            this.db.prepare(
                'UPDATE terminal_profiles SET is_default = 0 WHERE owner = ?',
            ).run(input.owner);
        }

        this.db.prepare(`
            INSERT INTO terminal_profiles (id, name, shell, args, cwd, env, startup_commands, owner, is_default, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            input.name,
            input.shell ?? '',
            JSON.stringify(input.args ?? []),
            input.cwd ?? '',
            JSON.stringify(input.env ?? {}),
            JSON.stringify(input.startupCommands ?? []),
            input.owner,
            input.isDefault ? 1 : 0,
            now,
            now,
        );

        this.logger.info({ id, name: input.name, owner: input.owner }, 'Terminal profile created');
        return this.get(id)!;
    }

    /**
     * Get a profile by ID.
     */
    get(id: string): TerminalProfile | undefined {
        const row = this.db.prepare(
            'SELECT * FROM terminal_profiles WHERE id = ?',
        ).get(id) as any;
        return row ? this.toProfile(row) : undefined;
    }

    /**
     * List profiles for an owner.
     */
    list(owner?: string): TerminalProfile[] {
        const rows = owner
            ? this.db.prepare('SELECT * FROM terminal_profiles WHERE owner = ? ORDER BY name').all(owner) as any[]
            : this.db.prepare('SELECT * FROM terminal_profiles ORDER BY name').all() as any[];
        return rows.map((r) => this.toProfile(r));
    }

    /**
     * Get the default profile for an owner.
     */
    getDefault(owner: string): TerminalProfile | undefined {
        const row = this.db.prepare(
            'SELECT * FROM terminal_profiles WHERE owner = ? AND is_default = 1',
        ).get(owner) as any;
        return row ? this.toProfile(row) : undefined;
    }

    /**
     * Update a profile.
     */
    update(id: string, input: UpdateProfileInput): TerminalProfile | undefined {
        const existing = this.get(id);
        if (!existing) return undefined;

        const now = new Date().toISOString();

        if (input.isDefault) {
            this.db.prepare(
                'UPDATE terminal_profiles SET is_default = 0 WHERE owner = ?',
            ).run(existing.owner);
        }

        this.db.prepare(`
            UPDATE terminal_profiles SET
                name = ?, shell = ?, args = ?, cwd = ?, env = ?,
                startup_commands = ?, is_default = ?, updated_at = ?
            WHERE id = ?
        `).run(
            input.name ?? existing.name,
            input.shell ?? existing.shell,
            JSON.stringify(input.args ?? existing.args),
            input.cwd ?? existing.cwd,
            JSON.stringify(input.env ?? existing.env),
            JSON.stringify(input.startupCommands ?? existing.startupCommands),
            (input.isDefault ?? existing.isDefault) ? 1 : 0,
            now,
            id,
        );

        this.logger.info({ id }, 'Terminal profile updated');
        return this.get(id);
    }

    /**
     * Delete a profile.
     */
    delete(id: string): boolean {
        const result = this.db.prepare('DELETE FROM terminal_profiles WHERE id = ?').run(id);
        if (result.changes > 0) {
            this.logger.info({ id }, 'Terminal profile deleted');
            return true;
        }
        return false;
    }

    /**
     * Convert a database row to a TerminalProfile object.
     */
    private toProfile(row: any): TerminalProfile {
        return {
            id: row.id,
            name: row.name,
            shell: row.shell,
            args: JSON.parse(row.args || '[]'),
            cwd: row.cwd,
            env: JSON.parse(row.env || '{}'),
            startupCommands: JSON.parse(row.startup_commands || '[]'),
            owner: row.owner,
            isDefault: row.is_default === 1,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
