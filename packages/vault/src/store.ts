/**
 * Secret CRUD store backed by encrypted SQLite.
 *
 * - Each secret has a unique name, versioned values, and metadata.
 * - Secret values are encrypted with per-secret DEKs, which are wrapped with the MEK.
 * - The SQLite database itself is also encrypted (page-level) via better-sqlite3-multiple-ciphers.
 */

import type BetterSqlite3 from "better-sqlite3-multiple-ciphers";
import type { RootDatabaseOrm } from '@orch/shared/db';
import { randomUUID } from "node:crypto";
import { OrchestratorError, ErrorCode } from "@orch/shared";
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { integer, sqliteTable, text, blob } from 'drizzle-orm/sqlite-core';
import { VaultCrypto } from "./crypto.js";
import type { WrappedKey, EncryptedData } from "./crypto.js";

const vaultMetaTable = sqliteTable('vault_meta', {
	key: text('key').primaryKey(),
	value: blob('value', { mode: 'buffer' }).notNull(),
});

const secretsTable = sqliteTable('secrets', {
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

// ─── Types ───────────────────────────────────────────────────────────────────

interface SecretRow {
	id: string;
	name: string;
	version: number;
	wrapped_dek: Buffer;
	dek_nonce: Buffer;
	dek_tag: Buffer;
	ciphertext: Buffer;
	nonce: Buffer;
	tag: Buffer;
	metadata: string | null;
	created_at: string;
	deleted_at: string | null;
}

export interface SecretMetadata {
	id: string;
	name: string;
	version: number;
	metadata?: Record<string, unknown>;
	createdAt: string;
}

// ─── Implementation ─────────────────────────────────────────────────────────

export class VaultStore {
	private db: BetterSqlite3.Database;
	private orm: RootDatabaseOrm;
	private crypto: VaultCrypto;
	private maxVersions: number;

	constructor(
		db: BetterSqlite3.Database,
		orm: RootDatabaseOrm,
		crypto: VaultCrypto,
		maxVersions: number = 5,
	) {
		this.db = db;
		this.orm = orm;
		this.crypto = crypto;
		this.maxVersions = maxVersions;
		this.initSchema();
	}

	private initSchema(): void {
		// Step 1: Create tables (without owner — avoids conflict with existing DBs)
		this.db.exec(`
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
		const secretColumns = this.db.pragma('table_info(secrets)') as Array<{ name: string }>;
		const hasOwnerColumn = secretColumns.some((c) => c.name === 'owner');
		if (!hasOwnerColumn) {
			this.db.exec(
				"ALTER TABLE secrets ADD COLUMN owner TEXT NOT NULL DEFAULT '__system__'",
			);
		}

		// Step 3: Owner index (safe now — column guaranteed to exist)
		this.db.exec(
			"CREATE INDEX IF NOT EXISTS idx_secrets_owner ON secrets(owner)",
		);
	}

	/**
	 * Initialize the vault: store salt and sentinel if first run, or verify passphrase.
	 */
	async init(passphrase: string): Promise<void> {
		const existingSalt = this.orm
			.select({ value: vaultMetaTable.value })
			.from(vaultMetaTable)
			.where(eq(vaultMetaTable.key, 'argon2_salt'))
			.get() as { value: Buffer } | undefined;

		if (existingSalt) {
			// Existing vault — derive MEK and verify sentinel
			await this.crypto.deriveMek(passphrase, existingSalt.value);

			const sentinel = this.orm
				.select({ value: vaultMetaTable.value })
				.from(vaultMetaTable)
				.where(eq(vaultMetaTable.key, 'sentinel'))
				.get() as { value: Buffer } | undefined;

			if (sentinel) {
				try {
					// Sentinel is a known value encrypted with MEK
					const encrypted: EncryptedData = JSON.parse(
						sentinel.value.toString(),
					) as EncryptedData;
					// Convert JSON-stored arrays back to Buffers
					encrypted.ciphertext = Buffer.from(encrypted.ciphertext);
					encrypted.nonce = Buffer.from(encrypted.nonce);
					encrypted.tag = Buffer.from(encrypted.tag);

					const dek = this.crypto.generateDek(); // We need sentinel DEK
					void dek; // Sentinel uses MEK directly for simplicity
					// Actually, for sentinel, we just encrypt a known string with MEK
					// and try to decrypt it to verify
					this.crypto.decrypt(
						encrypted,
						await this.crypto.deriveMek(passphrase, existingSalt.value),
					);
				} catch {
					this.crypto.zeroize();
					throw new OrchestratorError(
						ErrorCode.VAULT_WRONG_PASSPHRASE,
						"Incorrect vault passphrase.",
					);
				}
			}
		} else {
			// First run — generate salt, derive MEK, store sentinel
			const salt = this.crypto.generateSalt();
			const mek = await this.crypto.deriveMek(passphrase, salt);

			// Create sentinel: encrypt a known value with MEK
			const sentinelPlain = Buffer.from("orchestrator-vault-sentinel");
			const sentinelEncrypted = this.crypto.encrypt(sentinelPlain, mek);

			this.orm.insert(vaultMetaTable).values({ key: 'argon2_salt', value: salt }).run();

			this.orm.insert(vaultMetaTable).values({
				key: 'sentinel',
				value: Buffer.from(
					JSON.stringify({
						ciphertext: Array.from(sentinelEncrypted.ciphertext),
						nonce: Array.from(sentinelEncrypted.nonce),
						tag: Array.from(sentinelEncrypted.tag),
					}),
				),
			}).run();
		}
	}

	/**
	 * Create a new secret.
	 * @param owner - identity of the user who owns this secret ('__system__' for internal)
	 */
	create(
		name: string,
		value: string,
		metadata?: Record<string, unknown>,
		owner: string = "__system__",
	): SecretMetadata {
		// Check for existing
		const existing = this.orm
			.select({ name: secretsTable.name })
			.from(secretsTable)
			.where(and(eq(secretsTable.name, name), isNull(secretsTable.deleted_at)))
			.get() as { name: string } | undefined;

		if (existing) {
			throw new OrchestratorError(
				ErrorCode.SECRET_ALREADY_EXISTS,
				`Secret "${name}" already exists. Use update() to create a new version.`,
			);
		}

		return this.writeVersion(name, value, 1, metadata, owner);
	}

	/**
	 * Get a secret value by name (latest version by default).
	 * @param requester - identity + roles for ACL check
	 */
	get(
		name: string,
		version?: number,
		requester?: { identity: string; roles: string[] },
	): {
		name: string;
		value: string;
		version: number;
		metadata?: Record<string, unknown>;
	} {
		let row: SecretRow | undefined;

		if (version !== undefined) {
			row = this.orm
				.select()
				.from(secretsTable)
				.where(and(eq(secretsTable.name, name), eq(secretsTable.version, version), isNull(secretsTable.deleted_at)))
				.get() as SecretRow | undefined;
		} else {
			row = this.orm
				.select()
				.from(secretsTable)
				.where(and(eq(secretsTable.name, name), isNull(secretsTable.deleted_at)))
				.orderBy(desc(secretsTable.version))
				.get() as SecretRow | undefined;
		}

		if (!row) {
			throw new OrchestratorError(
				ErrorCode.SECRET_NOT_FOUND,
				`Secret "${name}"${version !== undefined ? ` version ${version}` : ""} not found.`,
			);
		}

		// ACL: unless requester is admin or system, must be the owner
		if (requester) {
			const owner = (row as any).owner;
			if (owner !== requester.identity && !requester.roles.includes("admin")) {
				throw new OrchestratorError(
					ErrorCode.PERMISSION_DENIED,
					`Access denied to secret "${name}"`,
				);
			}
		}

		// Unwrap DEK
		const wrappedKey: WrappedKey = {
			wrappedDek: row.wrapped_dek,
			nonce: row.dek_nonce,
			tag: row.dek_tag,
		};
		const dek = this.crypto.unwrapDek(wrappedKey);

		// Decrypt value
		const encrypted: EncryptedData = {
			ciphertext: row.ciphertext,
			nonce: row.nonce,
			tag: row.tag,
		};
		const plaintext = this.crypto.decrypt(encrypted, dek);

		return {
			name: row.name,
			value: plaintext.toString("utf-8"),
			version: row.version,
			metadata: row.metadata
				? (JSON.parse(row.metadata) as Record<string, unknown>)
				: undefined,
		};
	}

	/**
	 * Update a secret — creates a new version.
	 */
	update(
		name: string,
		value: string,
		metadata?: Record<string, unknown>,
		requester?: { identity: string; roles: string[] },
	): SecretMetadata {
		const latest = this.orm
			.select({ version: secretsTable.version, owner: secretsTable.owner })
			.from(secretsTable)
			.where(and(eq(secretsTable.name, name), isNull(secretsTable.deleted_at)))
			.orderBy(desc(secretsTable.version))
			.get() as { version: number; owner?: string } | undefined;

		if (!latest) {
			throw new OrchestratorError(
				ErrorCode.SECRET_NOT_FOUND,
				`Secret "${name}" not found. Use create() first.`,
			);
		}

		// ACL check
		if (requester && latest.owner) {
			if (
				latest.owner !== requester.identity &&
				!requester.roles.includes("admin")
			) {
				throw new OrchestratorError(
					ErrorCode.PERMISSION_DENIED,
					`Access denied to secret "${name}"`,
				);
			}
		}

		const newVersion = latest.version + 1;
		const result = this.writeVersion(
			name,
			value,
			newVersion,
			metadata,
			latest.owner,
		);

		// Prune old versions if exceeding max
		this.pruneVersions(name);

		return result;
	}

	/**
	 * Delete a secret (soft delete by default).
	 */
	delete(name: string, hard: boolean = false): void {
		if (hard) {
			const result = this.orm.delete(secretsTable).where(eq(secretsTable.name, name)).run();
			if (result.changes === 0) {
				throw new OrchestratorError(
					ErrorCode.SECRET_NOT_FOUND,
					`Secret "${name}" not found.`,
				);
			}
		} else {
			const result = this.orm
				.update(secretsTable)
				.set({ deleted_at: new Date().toISOString() })
				.where(and(eq(secretsTable.name, name), isNull(secretsTable.deleted_at)))
				.run();
			if (result.changes === 0) {
				throw new OrchestratorError(
					ErrorCode.SECRET_NOT_FOUND,
					`Secret "${name}" not found.`,
				);
			}
		}
	}

	/**
	 * List secrets — returns metadata only, never values.
	 * Scoped to owner unless admin.
	 */
	list(
		options: {
			prefix?: string;
			limit?: number;
			offset?: number;
			owner?: string;
			roles?: string[];
		} = {},
	): SecretMetadata[] {
		const { prefix, limit = 100, offset = 0, owner, roles = [] } = options;
		const isAdmin = roles.includes("admin");

		let rows = this.orm
			.select()
			.from(secretsTable)
			.where(isNull(secretsTable.deleted_at))
			.orderBy(secretsTable.name, desc(secretsTable.version))
			.all() as Array<SecretRow & { owner?: string }>;

		if (owner && !isAdmin) {
			rows = rows.filter((r) => (r as any).owner === owner || (r as any).owner === '__system__');
		}
		if (prefix) {
			rows = rows.filter((r) => r.name.startsWith(prefix));
		}

		const latestByName = new Map<string, SecretRow>();
		for (const row of rows) {
			if (!latestByName.has(row.name)) {
				latestByName.set(row.name, row);
			}
		}

		return Array.from(latestByName.values())
			.sort((a, b) => a.name.localeCompare(b.name))
			.slice(offset, offset + limit)
			.map((row) => ({
				id: row.id,
				name: row.name,
				version: row.version,
				metadata: row.metadata
					? (JSON.parse(row.metadata) as Record<string, unknown>)
					: undefined,
				createdAt: row.created_at,
			}));
	}

	// ─── Private Helpers ─────────────────────────────────────────────────

	private writeVersion(
		name: string,
		value: string,
		version: number,
		metadata?: Record<string, unknown>,
		owner: string = "__system__",
	): SecretMetadata {
		const id = randomUUID();
		const dek = this.crypto.generateDek();
		const wrappedKey = this.crypto.wrapDek(dek);
		const encrypted = this.crypto.encrypt(Buffer.from(value, "utf-8"), dek);
		const now = new Date().toISOString();

		this.orm
			.insert(secretsTable)
			.values({
				id,
				name,
				version,
				owner,
				wrapped_dek: wrappedKey.wrappedDek,
				dek_nonce: wrappedKey.nonce,
				dek_tag: wrappedKey.tag,
				ciphertext: encrypted.ciphertext,
				nonce: encrypted.nonce,
				tag: encrypted.tag,
				metadata: metadata ? JSON.stringify(metadata) : null,
				created_at: now,
				deleted_at: null,
			})
			.run();

		return { id, name, version, metadata, createdAt: now };
	}

	private pruneVersions(name: string): void {
		const versions = this.orm
			.select({ id: secretsTable.id, version: secretsTable.version })
			.from(secretsTable)
			.where(and(eq(secretsTable.name, name), isNull(secretsTable.deleted_at)))
			.orderBy(desc(secretsTable.version))
			.all() as Array<{ id: string; version: number }>;

		if (versions.length > this.maxVersions) {
			const toDelete = versions.slice(this.maxVersions);
			const ids = toDelete.map((v) => v.id);
			this.orm.delete(secretsTable).where(inArray(secretsTable.id, ids)).run();
		}
	}
}
