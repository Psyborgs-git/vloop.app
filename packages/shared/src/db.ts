/**
 * Encrypted SQLite database manager.
 *
 * Uses better-sqlite3-multiple-ciphers for AES-256 page-level encryption.
 * The .db file is unreadable without the encryption passphrase.
 */

import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { OrchestratorError, ErrorCode } from './errors.js';

export type RootDatabaseEngine = 'sqlite' | 'mysql' | 'postgres';
/**
 * Keep ORM type intentionally broad while multiple packages are being migrated.
 * This avoids nominal type conflicts when Drizzle resolves from different
 * node_modules locations in the monorepo.
 */
export type RootDatabaseOrm = any;

export interface DatabaseOptions {
    /** Root DB engine. Defaults to sqlite. */
    engine?: RootDatabaseEngine;
    /** Path to the SQLite database file. */
    path: string;
    /** Encryption passphrase. The DB file is unreadable without this. */
    passphrase: string;
    /** Enable WAL mode (default: true). */
    walMode?: boolean;
}

export class DatabaseManager {
    private db: BetterSqlite3.Database | null = null;
    private orm: RootDatabaseOrm | null = null;
    private readonly options: Required<DatabaseOptions>;

    constructor(options: DatabaseOptions) {
        this.options = {
            engine: 'sqlite',
            walMode: true,
            ...options,
        };
    }

    /**
     * Open the encrypted database connection.
     * Creates the database file and parent directories if they don't exist.
     */
    open(): BetterSqlite3.Database {
        if (this.db) {
            return this.db;
        }

        if (this.options.engine !== 'sqlite') {
            throw new OrchestratorError(
                ErrorCode.CONFIG_INVALID,
                `Database engine '${this.options.engine}' is not available for root services yet. Complete service repository migration before enabling it.`,
                { engine: this.options.engine },
            );
        }

        try {
            // Ensure parent directory exists
            mkdirSync(dirname(this.options.path), { recursive: true });

            this.db = new Database(this.options.path);

            // Apply encryption key — this is the SQLCipher PRAGMA that makes
            // the file unreadable without the passphrase.
            this.db.pragma(`key='${this.options.passphrase.replace(/'/g, "''")}'`);

            // Enable WAL mode for concurrent reads
            if (this.options.walMode) {
                this.db.pragma('journal_mode = WAL');
            }

            // Performance pragmas
            this.db.pragma('busy_timeout = 5000');
            this.db.pragma('synchronous = NORMAL');
            this.db.pragma('foreign_keys = ON');

            // Verify the key worked by running a simple query
            // If the passphrase is wrong, this will throw
            this.db.pragma('schema_version');
            this.orm = drizzle(this.db);

            return this.db;
        } catch (err) {
            this.db = null;
            this.orm = null;
            const message = err instanceof Error ? err.message : String(err);

            if (message.includes('not a database') || message.includes('decrypt')) {
                throw new OrchestratorError(
                    ErrorCode.DB_ENCRYPTION_FAILED,
                    'Failed to open encrypted database — wrong passphrase or corrupted file.',
                    { path: this.options.path },
                );
            }

            throw new OrchestratorError(
                ErrorCode.DB_ERROR,
                `Failed to open database: ${message}`,
                { path: this.options.path },
            );
        }
    }

    /**
     * Get the underlying database instance. Throws if not open.
     */
    getDb(): BetterSqlite3.Database {
        if (!this.db) {
            throw new OrchestratorError(
                ErrorCode.DB_ERROR,
                'Database is not open. Call open() first.',
            );
        }
        return this.db;
    }

    /**
     * Get Drizzle ORM facade for the root database.
     */
    getOrm(): RootDatabaseOrm {
        if (!this.orm) {
            throw new OrchestratorError(
                ErrorCode.DB_ERROR,
                'Database ORM is not initialized. Call open() first.',
            );
        }
        return this.orm;
    }

    getEngine(): RootDatabaseEngine {
        return this.options.engine;
    }

    /**
     * Run a migration: execute SQL statements to create/alter tables.
     */
    migrate(sql: string): void {
        const db = this.getDb();
        db.exec(sql);
    }

    /**
     * Close the database connection gracefully.
     */
    close(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
            this.orm = null;
        }
    }

    /**
     * Check if the database is currently open.
     */
    isOpen(): boolean {
        return this.db !== null;
    }
}
