/**
 * @orch/auth — Centralized Drizzle table definitions and schema init.
 *
 * All auth-related tables are defined here and exported for use
 * across token-manager, user, audit, session, and jwt-provider modules.
 */

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// ─── Tables ──────────────────────────────────────────────────────────────────

export const tokensTable = sqliteTable('persistent_tokens', {
	id: text('id').primaryKey(),
	token_hash: text('token_hash').notNull(),
	name: text('name').notNull(),
	identity: text('identity').notNull(),
	token_type: text('token_type').notNull(),
	roles: text('roles').notNull(),
	scopes: text('scopes').notNull(),
	created_at: text('created_at').notNull(),
	expires_at: text('expires_at'),
	last_used_at: text('last_used_at'),
	revoked: integer('revoked').notNull().default(0),
});

export const usersTable = sqliteTable('users', {
	id: text('id').primaryKey(),
	email: text('email').notNull(),
	password_hash: text('password_hash'),
	allowed_roles: text('allowed_roles').notNull(),
	created_at: text('created_at').notNull(),
});

export const auditLogTable = sqliteTable('audit_log', {
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

export const sessionsTable = sqliteTable('sessions', {
	id: text('id').primaryKey(),
	token_hash: text('token_hash').notNull(),
	identity: text('identity').notNull(),
	roles: text('roles').notNull(),
	created_at: text('created_at').notNull(),
	last_active: text('last_active').notNull(),
	expires_at: text('expires_at').notNull(),
	conn_meta: text('conn_meta'),
	revoked: integer('revoked').notNull().default(0),
});

export const jwtProvidersTable = sqliteTable('jwt_providers', {
	id: text('id').primaryKey(),
	issuer: text('issuer').notNull(),
	jwks_url: text('jwks_url').notNull(),
	audience: text('audience').notNull(),
	created_at: text('created_at').notNull(),
});

// ─── Unified Schema ─────────────────────────────────────────────────────────

export const authSchema = {
	tokensTable,
	usersTable,
	auditLogTable,
	sessionsTable,
	jwtProvidersTable,
} as const;

// ─── Schema Init ─────────────────────────────────────────────────────────────

/**
 * Idempotent DDL for all auth tables.
 * Called once during package initialisation (before any CRUD).
 */
export function initAuthSchema(db: { exec(sql: string): unknown }): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS persistent_tokens (
			id            TEXT PRIMARY KEY,
			token_hash    TEXT NOT NULL UNIQUE,
			name          TEXT NOT NULL,
			identity      TEXT NOT NULL,
			token_type    TEXT NOT NULL,
			roles         TEXT NOT NULL,
			scopes        TEXT NOT NULL,
			created_at    TEXT NOT NULL,
			expires_at    TEXT,
			last_used_at  TEXT,
			revoked       INTEGER DEFAULT 0
		);
		CREATE INDEX IF NOT EXISTS idx_pt_identity   ON persistent_tokens(identity);
		CREATE INDEX IF NOT EXISTS idx_pt_token_hash ON persistent_tokens(token_hash);

		CREATE TABLE IF NOT EXISTS users (
			id            TEXT PRIMARY KEY,
			email         TEXT NOT NULL UNIQUE,
			password_hash TEXT,
			allowed_roles TEXT NOT NULL,
			created_at    TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

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
		CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC);
		CREATE INDEX IF NOT EXISTS idx_audit_identity  ON audit_log(identity);
		CREATE INDEX IF NOT EXISTS idx_audit_topic     ON audit_log(topic);

		CREATE TABLE IF NOT EXISTS sessions (
			id          TEXT PRIMARY KEY,
			token_hash  TEXT NOT NULL,
			identity    TEXT NOT NULL,
			roles       TEXT NOT NULL,
			created_at  TEXT NOT NULL,
			last_active TEXT NOT NULL,
			expires_at  TEXT NOT NULL,
			conn_meta   TEXT,
			revoked     INTEGER NOT NULL DEFAULT 0
		);
		CREATE INDEX IF NOT EXISTS idx_sessions_identity ON sessions(identity);
		CREATE INDEX IF NOT EXISTS idx_sessions_hash     ON sessions(token_hash);
		CREATE INDEX IF NOT EXISTS idx_sessions_expires   ON sessions(expires_at);

		CREATE TABLE IF NOT EXISTS jwt_providers (
			id         TEXT PRIMARY KEY,
			issuer     TEXT NOT NULL UNIQUE,
			jwks_url   TEXT NOT NULL,
			audience   TEXT NOT NULL,
			created_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_jwt_providers_issuer     ON jwt_providers(issuer);
		CREATE INDEX IF NOT EXISTS idx_jwt_providers_created_at ON jwt_providers(created_at DESC);
	`);
}
