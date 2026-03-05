/**
 * @orch/plugin-manager — Centralized Drizzle table definitions and schema init.
 */

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// ─── Tables ──────────────────────────────────────────────────────────────────

export const pluginsTable = sqliteTable('plugins', {
	id: text('id').primaryKey(),
	enabled: integer('enabled').notNull().default(1),
	manifest: text('manifest').notNull(),
	granted_permissions: text('granted_permissions').notNull(),
	installed_at: text('installed_at').notNull(),
	db_id: text('db_id'),
});

// ─── Unified Schema ─────────────────────────────────────────────────────────

export const pluginManagerSchema = {
	pluginsTable,
} as const;

// ─── Schema Init ─────────────────────────────────────────────────────────────

export function initPluginManagerSchema(db: { exec(sql: string): unknown }): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS plugins (
			id                  TEXT PRIMARY KEY,
			enabled             INTEGER DEFAULT 1,
			manifest            TEXT NOT NULL,
			granted_permissions TEXT NOT NULL,
			installed_at        TEXT NOT NULL,
			db_id               TEXT
		);
	`);
}
