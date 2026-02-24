/**
 * Secret CRUD store backed by encrypted SQLite.
 *
 * - Each secret has a unique name, versioned values, and metadata.
 * - Secret values are encrypted with per-secret DEKs, which are wrapped with the MEK.
 * - The SQLite database itself is also encrypted (page-level) via better-sqlite3-multiple-ciphers.
 */

import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';
import { randomUUID } from 'node:crypto';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import { VaultCrypto } from './crypto.js';
import type { WrappedKey, EncryptedData } from './crypto.js';

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
    private crypto: VaultCrypto;
    private maxVersions: number;

    constructor(db: BetterSqlite3.Database, crypto: VaultCrypto, maxVersions: number = 5) {
        this.db = db;
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
        try {
            this.db.prepare("SELECT owner FROM secrets LIMIT 1").get();
        } catch {
            this.db.exec("ALTER TABLE secrets ADD COLUMN owner TEXT NOT NULL DEFAULT '__system__'");
        }

        // Step 3: Owner index (safe now — column guaranteed to exist)
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_secrets_owner ON secrets(owner)");
    }

    /**
     * Initialize the vault: store salt and sentinel if first run, or verify passphrase.
     */
    async init(passphrase: string): Promise<void> {
        const existingSalt = this.db.prepare(
            "SELECT value FROM vault_meta WHERE key = 'argon2_salt'",
        ).get() as { value: Buffer } | undefined;

        if (existingSalt) {
            // Existing vault — derive MEK and verify sentinel
            await this.crypto.deriveMek(passphrase, existingSalt.value);

            const sentinel = this.db.prepare(
                "SELECT value FROM vault_meta WHERE key = 'sentinel'",
            ).get() as { value: Buffer } | undefined;

            if (sentinel) {
                try {
                    // Sentinel is a known value encrypted with MEK
                    const encrypted: EncryptedData = JSON.parse(sentinel.value.toString()) as EncryptedData;
                    // Convert JSON-stored arrays back to Buffers
                    encrypted.ciphertext = Buffer.from(encrypted.ciphertext);
                    encrypted.nonce = Buffer.from(encrypted.nonce);
                    encrypted.tag = Buffer.from(encrypted.tag);

                    const dek = this.crypto.generateDek(); // We need sentinel DEK
                    void dek; // Sentinel uses MEK directly for simplicity
                    // Actually, for sentinel, we just encrypt a known string with MEK
                    // and try to decrypt it to verify
                    this.crypto.decrypt(encrypted, await this.crypto.deriveMek(passphrase, existingSalt.value));
                } catch {
                    this.crypto.zeroize();
                    throw new OrchestratorError(
                        ErrorCode.VAULT_WRONG_PASSPHRASE,
                        'Incorrect vault passphrase.',
                    );
                }
            }
        } else {
            // First run — generate salt, derive MEK, store sentinel
            const salt = this.crypto.generateSalt();
            const mek = await this.crypto.deriveMek(passphrase, salt);

            // Create sentinel: encrypt a known value with MEK
            const sentinelPlain = Buffer.from('orchestrator-vault-sentinel');
            const sentinelEncrypted = this.crypto.encrypt(sentinelPlain, mek);

            this.db.prepare(
                "INSERT INTO vault_meta (key, value) VALUES ('argon2_salt', ?)",
            ).run(salt);

            this.db.prepare(
                "INSERT INTO vault_meta (key, value) VALUES ('sentinel', ?)",
            ).run(Buffer.from(JSON.stringify({
                ciphertext: Array.from(sentinelEncrypted.ciphertext),
                nonce: Array.from(sentinelEncrypted.nonce),
                tag: Array.from(sentinelEncrypted.tag),
            })));
        }
    }

    /**
     * Create a new secret.
     * @param owner - identity of the user who owns this secret ('__system__' for internal)
     */
    create(name: string, value: string, metadata?: Record<string, unknown>, owner: string = '__system__'): SecretMetadata {
        // Check for existing
        const existing = this.db.prepare(
            'SELECT name FROM secrets WHERE name = ? AND deleted_at IS NULL LIMIT 1',
        ).get(name) as { name: string } | undefined;

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
    get(name: string, version?: number, requester?: { identity: string; roles: string[] }): { name: string; value: string; version: number; metadata?: Record<string, unknown> } {
        let row: SecretRow | undefined;

        if (version !== undefined) {
            row = this.db.prepare(
                'SELECT * FROM secrets WHERE name = ? AND version = ? AND deleted_at IS NULL',
            ).get(name, version) as SecretRow | undefined;
        } else {
            row = this.db.prepare(
                'SELECT * FROM secrets WHERE name = ? AND deleted_at IS NULL ORDER BY version DESC LIMIT 1',
            ).get(name) as SecretRow | undefined;
        }

        if (!row) {
            throw new OrchestratorError(
                ErrorCode.SECRET_NOT_FOUND,
                `Secret "${name}"${version !== undefined ? ` version ${version}` : ''} not found.`,
            );
        }

        // ACL: unless requester is admin or system, must be the owner
        if (requester && (row as any).owner !== '__system__') {
            const owner = (row as any).owner;
            if (owner !== requester.identity && !requester.roles.includes('admin')) {
                throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, `Access denied to secret "${name}"`);
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
            value: plaintext.toString('utf-8'),
            version: row.version,
            metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : undefined,
        };
    }

    /**
     * Update a secret — creates a new version.
     */
    update(name: string, value: string, metadata?: Record<string, unknown>, requester?: { identity: string; roles: string[] }): SecretMetadata {
        const latest = this.db.prepare(
            'SELECT version, owner FROM secrets WHERE name = ? AND deleted_at IS NULL ORDER BY version DESC LIMIT 1',
        ).get(name) as { version: number; owner?: string } | undefined;

        if (!latest) {
            throw new OrchestratorError(
                ErrorCode.SECRET_NOT_FOUND,
                `Secret "${name}" not found. Use create() first.`,
            );
        }

        // ACL check
        if (requester && latest.owner && latest.owner !== '__system__') {
            if (latest.owner !== requester.identity && !requester.roles.includes('admin')) {
                throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, `Access denied to secret "${name}"`);
            }
        }

        const newVersion = latest.version + 1;
        const result = this.writeVersion(name, value, newVersion, metadata, latest.owner);

        // Prune old versions if exceeding max
        this.pruneVersions(name);

        return result;
    }

    /**
     * Delete a secret (soft delete by default).
     */
    delete(name: string, hard: boolean = false): void {
        if (hard) {
            const result = this.db.prepare('DELETE FROM secrets WHERE name = ?').run(name);
            if (result.changes === 0) {
                throw new OrchestratorError(ErrorCode.SECRET_NOT_FOUND, `Secret "${name}" not found.`);
            }
        } else {
            const result = this.db.prepare(
                'UPDATE secrets SET deleted_at = ? WHERE name = ? AND deleted_at IS NULL',
            ).run(new Date().toISOString(), name);
            if (result.changes === 0) {
                throw new OrchestratorError(ErrorCode.SECRET_NOT_FOUND, `Secret "${name}" not found.`);
            }
        }
    }

    /**
     * List secrets — returns metadata only, never values.
     * Scoped to owner unless admin.
     */
    list(options: { prefix?: string; limit?: number; offset?: number; owner?: string; roles?: string[] } = {}): SecretMetadata[] {
        const { prefix, limit = 100, offset = 0, owner, roles = [] } = options;
        const isAdmin = roles.includes('admin');

        let query = 'SELECT DISTINCT name, MAX(version) as version, metadata, created_at, id FROM secrets WHERE deleted_at IS NULL';
        const params: unknown[] = [];

        // Owner scoping — admins see all, users see only their own + system
        if (owner && !isAdmin) {
            query += ' AND (owner = ? OR owner = \'__system__\')';
            params.push(owner);
        }

        if (prefix) {
            query += ' AND name LIKE ?';
            params.push(`${prefix}%`);
        }

        query += ' GROUP BY name ORDER BY name LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const rows = this.db.prepare(query).all(...params) as Array<{
            id: string;
            name: string;
            version: number;
            metadata: string | null;
            created_at: string;
        }>;

        return rows.map((row) => ({
            id: row.id,
            name: row.name,
            version: row.version,
            metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : undefined,
            createdAt: row.created_at,
        }));
    }

    // ─── Private Helpers ─────────────────────────────────────────────────

    private writeVersion(
        name: string,
        value: string,
        version: number,
        metadata?: Record<string, unknown>,
        owner: string = '__system__',
    ): SecretMetadata {
        const id = randomUUID();
        const dek = this.crypto.generateDek();
        const wrappedKey = this.crypto.wrapDek(dek);
        const encrypted = this.crypto.encrypt(Buffer.from(value, 'utf-8'), dek);
        const now = new Date().toISOString();

        this.db.prepare(`
      INSERT INTO secrets (id, name, version, owner, wrapped_dek, dek_nonce, dek_tag, ciphertext, nonce, tag, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            id, name, version, owner,
            wrappedKey.wrappedDek, wrappedKey.nonce, wrappedKey.tag,
            encrypted.ciphertext, encrypted.nonce, encrypted.tag,
            metadata ? JSON.stringify(metadata) : null,
            now,
        );

        return { id, name, version, metadata, createdAt: now };
    }

    private pruneVersions(name: string): void {
        const versions = this.db.prepare(
            'SELECT id, version FROM secrets WHERE name = ? AND deleted_at IS NULL ORDER BY version DESC',
        ).all(name) as Array<{ id: string; version: number }>;

        if (versions.length > this.maxVersions) {
            const toDelete = versions.slice(this.maxVersions);
            const ids = toDelete.map((v) => v.id);
            this.db.prepare(
                `DELETE FROM secrets WHERE id IN (${ids.map(() => '?').join(',')})`,
            ).run(...ids);
        }
    }
}
