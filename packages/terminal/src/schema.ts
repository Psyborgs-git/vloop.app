/**
 * @orch/terminal — Centralized Drizzle table definitions and schema init.
 */

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// ─── Tables ──────────────────────────────────────────────────────────────────

export const terminalProfilesTable = sqliteTable('terminal_profiles', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	shell: text('shell').notNull(),
	args: text('args').notNull(),
	cwd: text('cwd').notNull(),
	env: text('env').notNull(),
	startup_commands: text('startup_commands').notNull(),
	owner: text('owner').notNull(),
	is_default: integer('is_default').notNull().default(0),
	created_at: text('created_at').notNull(),
	updated_at: text('updated_at').notNull(),
});

export const terminalSessionsTable = sqliteTable('terminal_sessions', {
	id: text('id').primaryKey(),
	owner: text('owner').notNull(),
	shell: text('shell').notNull(),
	cwd: text('cwd').notNull(),
	cols: integer('cols').notNull(),
	rows: integer('rows').notNull(),
	profile_id: text('profile_id'),
	log_path: text('log_path'),
	started_at: text('started_at').notNull(),
	ended_at: text('ended_at'),
	exit_code: integer('exit_code'),
});

// ─── Unified Schema ─────────────────────────────────────────────────────────

export const terminalSchema = {
	terminalProfilesTable,
	terminalSessionsTable,
} as const;

// ─── Schema Init ─────────────────────────────────────────────────────────────

export function initTerminalSchema(db: { exec(sql: string): unknown }): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS terminal_profiles (
			id               TEXT PRIMARY KEY,
			name             TEXT NOT NULL,
			shell            TEXT NOT NULL DEFAULT '',
			args             TEXT NOT NULL DEFAULT '[]',
			cwd              TEXT NOT NULL DEFAULT '',
			env              TEXT NOT NULL DEFAULT '{}',
			startup_commands TEXT NOT NULL DEFAULT '[]',
			owner            TEXT NOT NULL,
			is_default       INTEGER NOT NULL DEFAULT 0,
			created_at       TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE INDEX IF NOT EXISTS idx_terminal_profiles_owner ON terminal_profiles(owner);

		CREATE TABLE IF NOT EXISTS terminal_sessions (
			id         TEXT PRIMARY KEY,
			owner      TEXT NOT NULL,
			shell      TEXT NOT NULL DEFAULT '',
			cwd        TEXT NOT NULL DEFAULT '',
			cols       INTEGER NOT NULL DEFAULT 80,
			rows       INTEGER NOT NULL DEFAULT 24,
			profile_id TEXT,
			log_path   TEXT,
			started_at TEXT NOT NULL,
			ended_at   TEXT,
			exit_code  INTEGER
		);
		CREATE INDEX IF NOT EXISTS idx_terminal_sessions_owner
			ON terminal_sessions(owner);
		CREATE INDEX IF NOT EXISTS idx_terminal_sessions_started
			ON terminal_sessions(started_at DESC);
	`);
}
