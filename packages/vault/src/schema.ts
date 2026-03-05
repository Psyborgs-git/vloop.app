/**
 * @orch/vault — Centralized Drizzle table definitions and schema init.
 */

import { integer, sqliteTable, text, blob } from 'drizzle-orm/sqlite-core';

// ─── Tables ──────────────────────────────────────────────────────────────────

export const vaultMetaTable = sqliteTable('vault_meta', {
	key: text('key').primaryKey(),
	value: blob('value', { mode: 'buffer' }).notNull(),
});

export const secretsTable = sqliteTable('secrets', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	version: integer('version').notNull(),
	wrapped_dek: blob('wrapped_dek', { mode: 'buffer' }).notNull(),
	dek_nonce: blob('dek_nonce', { mode: 'buffer' }).notNull(),
	dek_tag: blob('dek_tag', { mode: 'buffer' }).notNull(),
	ciphertext: blob('ciphertext', { mode: 'buffer' }).notNull(),
	nonce: blob('nonce', { mode: 'buffer' }).notNull(),
	tag: blob('tag', { mode: 'buffer' }).notNull(),
	metadata: text('metadata'),
	created_at: text('created_at').notNull(),
	deleted_at: text('deleted_at'),
	owner: text('owner').notNull().default('__system__'),
});

// ─── Unified Schema ─────────────────────────────────────────────────────────

export const vaultSchema = {
	vaultMetaTable,
	secretsTable,
} as const;

// ─── Schema Init ─────────────────────────────────────────────────────────────

/**
 * Idempotent DDL + migration for all vault tables.
 * Requires the raw BetterSqlite3 database because of pragma-based migration.
 */
export function initVaultSchema(db: { exec(sql: string): unknown; pragma(s: string): unknown }): void {
	// Step 1: Create tables (without owner — avoids conflict with existing DBs)
	db.exec(`
		CREATE TABLE IF NOT EXISTS vault_meta (
			key   TEXT PRIMARY KEY,
			value BLOB NOT NULL
		);

		CREATE TABLE IF NOT EXISTS secrets (
			id          TEXT PRIMARY KEY,
			name        TEXT NOT NULL,
			version     INTEGER NOT NULL DEFAULT 1,
			wrapped_dek BLOB NOT NULL,
			dek_nonce   BLOB NOT NULL,
			dek_tag     BLOB NOT NULL,
			ciphertext  BLOB NOT NULL,
			nonce       BLOB NOT NULL,
			tag         BLOB NOT NULL,
			metadata    TEXT,
			created_at  TEXT NOT NULL,
			deleted_at  TEXT,
			UNIQUE(name, version)
		);
		CREATE INDEX IF NOT EXISTS idx_secrets_name ON secrets(name);
	`);

	// Step 2: Migration — add owner column if missing
	const secretColumns = db.pragma('table_info(secrets)') as Array<{ name: string }>;
	const hasOwnerColumn = secretColumns.some((c) => c.name === 'owner');
	if (!hasOwnerColumn) {
		db.exec(
			"ALTER TABLE secrets ADD COLUMN owner TEXT NOT NULL DEFAULT '__system__'",
		);
	}

	// Step 3: Owner index (safe now — column guaranteed to exist)
	db.exec(
		"CREATE INDEX IF NOT EXISTS idx_secrets_owner ON secrets(owner)",
	);
}
