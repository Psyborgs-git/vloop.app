/**
 * Terminal profile management.
 *
 * Stores and retrieves shell profiles (shell, cwd, env, etc.)
 * in the orchestrator's SQLite database.
 */

import type { Logger } from '@orch/daemon';
import { asc, eq } from 'drizzle-orm';
import { terminalProfilesTable, initTerminalSchema } from './schema.js';
import type { RootDatabaseOrm } from '@orch/shared/db';

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
    private readonly orm: RootDatabaseOrm;
    private readonly logger: Logger;

    constructor(db: { exec(sql: string): unknown }, orm: RootDatabaseOrm, logger: Logger) {
        initTerminalSchema(db);
        this.orm = orm;
        this.logger = logger.child({ component: 'terminal-profiles' });
    }

    /**
     * Create a new terminal profile.
     */
    create(input: CreateProfileInput): TerminalProfile {
        const id = `tp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const now = new Date().toISOString();

        // If setting as default, clear existing default for this owner
        if (input.isDefault) {
            this.orm.update(terminalProfilesTable)
                .set({ is_default: 0 })
                .where(eq(terminalProfilesTable.owner, input.owner))
                .run();
        }

        this.orm.insert(terminalProfilesTable).values({
            id,
            name: input.name,
            shell: input.shell ?? '',
            args: JSON.stringify(input.args ?? []),
            cwd: input.cwd ?? '',
            env: JSON.stringify(input.env ?? {}),
            startup_commands: JSON.stringify(input.startupCommands ?? []),
            owner: input.owner,
            is_default: input.isDefault ? 1 : 0,
            created_at: now,
            updated_at: now,
        }).run();

        this.logger.info({ id, name: input.name, owner: input.owner }, 'Terminal profile created');
        return this.get(id)!;
    }

    /**
     * Get a profile by ID.
     */
    get(id: string): TerminalProfile | undefined {
        const row = this.orm.select().from(terminalProfilesTable).where(eq(terminalProfilesTable.id, id)).get() as any;
        return row ? this.toProfile(row) : undefined;
    }

    /**
     * List profiles for an owner.
     */
    list(owner?: string): TerminalProfile[] {
        const rows = owner
            ? this.orm.select().from(terminalProfilesTable).where(eq(terminalProfilesTable.owner, owner)).orderBy(asc(terminalProfilesTable.name)).all() as any[]
            : this.orm.select().from(terminalProfilesTable).orderBy(asc(terminalProfilesTable.name)).all() as any[];
        return rows.map((r) => this.toProfile(r));
    }

    /**
     * Get the default profile for an owner.
     */
    getDefault(owner: string): TerminalProfile | undefined {
        const row = this.orm.select().from(terminalProfilesTable)
            .where(eq(terminalProfilesTable.owner, owner))
            .all()
            .find((r: any) => r.is_default === 1) as any;
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
            this.orm.update(terminalProfilesTable)
                .set({ is_default: 0 })
                .where(eq(terminalProfilesTable.owner, existing.owner))
                .run();
        }

        this.orm.update(terminalProfilesTable)
            .set({
                name: input.name ?? existing.name,
                shell: input.shell ?? existing.shell,
                args: JSON.stringify(input.args ?? existing.args),
                cwd: input.cwd ?? existing.cwd,
                env: JSON.stringify(input.env ?? existing.env),
                startup_commands: JSON.stringify(input.startupCommands ?? existing.startupCommands),
                is_default: (input.isDefault ?? existing.isDefault) ? 1 : 0,
                updated_at: now,
            })
            .where(eq(terminalProfilesTable.id, id))
            .run();

        this.logger.info({ id }, 'Terminal profile updated');
        return this.get(id);
    }

    /**
     * Delete a profile.
     */
    delete(id: string): boolean {
        const result = this.orm.delete(terminalProfilesTable).where(eq(terminalProfilesTable.id, id)).run();
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
