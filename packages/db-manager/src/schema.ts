/**
 * @orch/db-manager — Centralized Drizzle table definitions and schema init.
 */

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// ─── Tables ──────────────────────────────────────────────────────────────────

export const externalDatabasesTable = sqliteTable('external_databases', {
	id: text('id').primaryKey(),
	owner: text('owner').notNull(),
	label: text('label').notNull(),
	db_type: text('db_type').notNull(),
	host: text('host'),
	port: integer('port'),
	database_name: text('database_name'),
	ssl: integer('ssl').notNull().default(0),
	credentials_path: text('credentials_path'),
	created_at: text('created_at').notNull(),
});

// ─── Unified Schema ─────────────────────────────────────────────────────────

export const dbManagerSchema = {
	externalDatabasesTable,
} as const;

// ─── Schema Init ─────────────────────────────────────────────────────────────

export function initDbManagerSchema(db: { exec(sql: string): unknown }): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS external_databases (
			id               TEXT PRIMARY KEY,
			owner            TEXT NOT NULL,
			label            TEXT NOT NULL,
			db_type          TEXT NOT NULL,
			host             TEXT,
			port             INTEGER,
			database_name    TEXT,
			ssl              INTEGER DEFAULT 0,
			credentials_path TEXT,
			created_at       TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_ext_db_owner ON external_databases(owner);
	`);
}
