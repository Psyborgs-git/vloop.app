/**
 * External Database Registry — stores and manages connections to external databases.
 *
 * Supports PostgreSQL, MySQL, and SQLite.
 * Each config is owned by the user who created it. Only the owner (or admin) can access it.
 * Credentials are stored securely in the vault under owner-scoped paths.
 */

import { randomUUID } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';
import { VaultStore } from '@orch/vault';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { Logger } from '@orch/daemon';
import { desc, eq } from 'drizzle-orm';
import { externalDatabasesTable, initDbManagerSchema } from './schema.js';
import type { RootDatabaseOrm } from '@orch/shared/db';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExternalDbType = 'postgres' | 'mysql' | 'sqlite';

export interface ExternalDbConfig {
    id: string;
    owner: string;
    label: string;
    dbType: ExternalDbType;
    host?: string;
    port?: number;
    databaseName?: string;
    ssl?: boolean;
    createdAt: string;
}

export interface RegisterExternalDbOpts {
    label: string;
    dbType: ExternalDbType;
    host?: string;
    port?: number;
    databaseName?: string;
    ssl?: boolean;
    username?: string;
    password?: string;
    /** For SQLite external dbs — the file path */
    filePath?: string;
}

interface ExternalDbRow {
    id: string;
    owner: string;
    label: string;
    db_type: string;
    host: string | null;
    port: number | null;
    database_name: string | null;
    ssl: number;
    credentials_path: string | null;
    created_at: string;
}

// ─── Registry ────────────────────────────────────────────────────────────────

export class ExternalDatabaseRegistry {
    constructor(
        db: BetterSqlite3.Database,
        private readonly orm: RootDatabaseOrm,
        private readonly vault: VaultStore,
        private readonly logger: Logger,
    ) {
        initDbManagerSchema(db);
    }

    // ── ACL check ───────────────────────────────────────────────────────

    private assertOwnerOrAdmin(config: ExternalDbRow, identity: string, roles: string[]): void {
        if (config.owner !== identity && !roles.includes('admin')) {
            throw new OrchestratorError(
                ErrorCode.PERMISSION_DENIED,
                `Access denied: external DB "${config.label}" is owned by ${config.owner}`,
            );
        }
    }

    // ── Public Methods ──────────────────────────────────────────────────

    async register(owner: string, opts: RegisterExternalDbOpts): Promise<ExternalDbConfig> {
        const id = `extdb_${randomUUID()}`;
        const now = new Date().toISOString();

        // Store credentials in vault under owner-scoped path
        let credentialsPath: string | null = null;
        if (opts.username || opts.password || opts.filePath) {
            credentialsPath = `users/${owner}/ext-dbs/${id}/credentials`;
            const credValue = JSON.stringify({
                username: opts.username ?? '',
                password: opts.password ?? '',
                filePath: opts.filePath ?? '',
            });
            this.vault.create(credentialsPath, credValue, {
                description: `Credentials for external DB: ${opts.label}`,
            });
        }

        this.orm.insert(externalDatabasesTable).values({
            id,
            owner,
            label: opts.label,
            db_type: opts.dbType,
            host: opts.host ?? null,
            port: opts.port ?? null,
            database_name: opts.databaseName ?? null,
            ssl: opts.ssl ? 1 : 0,
            credentials_path: credentialsPath,
            created_at: now,
        }).run();

        this.logger.info({ id, owner, label: opts.label, dbType: opts.dbType }, 'Registered external database');

        return {
            id, owner, label: opts.label, dbType: opts.dbType,
            host: opts.host, port: opts.port,
            databaseName: opts.databaseName, ssl: opts.ssl,
            createdAt: now,
        };
    }

    list(owner: string, roles: string[]): ExternalDbConfig[] {
        const isAdmin = roles.includes('admin');
        const rows = isAdmin
            ? this.orm.select().from(externalDatabasesTable).orderBy(desc(externalDatabasesTable.created_at)).all() as ExternalDbRow[]
            : this.orm.select().from(externalDatabasesTable).where(eq(externalDatabasesTable.owner, owner)).orderBy(desc(externalDatabasesTable.created_at)).all() as ExternalDbRow[];

        return rows.map(r => ({
            id: r.id,
            owner: r.owner,
            label: r.label,
            dbType: r.db_type as ExternalDbType,
            host: r.host ?? undefined,
            port: r.port ?? undefined,
            databaseName: r.database_name ?? undefined,
            ssl: r.ssl === 1,
            createdAt: r.created_at,
        }));
    }

    private getRow(id: string): ExternalDbRow {
        const row = this.orm.select().from(externalDatabasesTable).where(eq(externalDatabasesTable.id, id)).get() as ExternalDbRow | undefined;
        if (!row) {
            throw new OrchestratorError(ErrorCode.NOT_FOUND, `External database config "${id}" not found`);
        }
        return row;
    }

    async remove(id: string, identity: string, roles: string[]): Promise<void> {
        const row = this.getRow(id);
        this.assertOwnerOrAdmin(row, identity, roles);

        // Remove vault credentials
        if (row.credentials_path) {
            try { this.vault.delete(row.credentials_path, true); } catch { /* ignore if not found */ }
        }

        this.orm.delete(externalDatabasesTable).where(eq(externalDatabasesTable.id, id)).run();
        this.logger.info({ id, identity }, 'Removed external database config');
    }

    async query(
        id: string,
        identity: string,
        roles: string[],
        sql: string,
        params: unknown[] = [],
    ): Promise<{ rows: Record<string, unknown>[]; columns: string[] }> {
        const row = this.getRow(id);
        this.assertOwnerOrAdmin(row, identity, roles);

        // Retrieve credentials from vault
        let creds: { username: string; password: string; filePath: string } = {
            username: '', password: '', filePath: '',
        };
        if (row.credentials_path) {
            try {
                const secret = this.vault.get(row.credentials_path);
                creds = JSON.parse(secret.value);
            } catch {
                throw new OrchestratorError(ErrorCode.NOT_FOUND, 'Credentials not found in vault for this database');
            }
        }

        switch (row.db_type as ExternalDbType) {
            case 'postgres':
                return this.queryPostgres(row, creds, sql, params);
            case 'mysql':
                return this.queryMysql(row, creds, sql, params);
            case 'sqlite':
                return this.querySqlite(creds, sql, params);
            default:
                throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, `Unsupported database type: ${row.db_type}`);
        }
    }

    async testConnection(
        id: string,
        identity: string,
        roles: string[],
    ): Promise<{ success: boolean; message: string }> {
        try {
            await this.query(id, identity, roles, 'SELECT 1 as test');
            return { success: true, message: 'Connection successful' };
        } catch (err: any) {
            return { success: false, message: err.message || String(err) };
        }
    }

    // ── Driver Query Methods ────────────────────────────────────────────

    private async queryPostgres(
        config: ExternalDbRow,
        creds: { username: string; password: string },
        sql: string,
        params: unknown[],
    ): Promise<{ rows: Record<string, unknown>[]; columns: string[] }> {
        let pg: any;
        try {
            // @ts-ignore — optional runtime dependency
            pg = await import('pg');
        } catch {
            throw new OrchestratorError(ErrorCode.SERVICE_UNAVAILABLE, 'PostgreSQL driver (pg) is not installed. Run: npm install pg');
        }

        const PgClient = pg.Client ?? pg.default?.Client;
        const client = new PgClient({
            host: config.host ?? 'localhost',
            port: config.port ?? 5432,
            database: config.database_name ?? 'postgres',
            user: creds.username,
            password: creds.password,
            ssl: config.ssl === 1 ? { rejectUnauthorized: false } : false,
            connectionTimeoutMillis: 10000,
        });

        try {
            await client.connect();
            const result = await client.query(sql, params);
            const columns = result.fields?.map((f: any) => f.name) ?? [];
            return { rows: result.rows ?? [], columns };
        } finally {
            await client.end().catch(() => { });
        }
    }

    private async queryMysql(
        config: ExternalDbRow,
        creds: { username: string; password: string },
        sql: string,
        params: unknown[],
    ): Promise<{ rows: Record<string, unknown>[]; columns: string[] }> {
        let mysql: any;
        try {
            // @ts-ignore — optional runtime dependency
            mysql = await import('mysql2/promise');
        } catch {
            throw new OrchestratorError(ErrorCode.SERVICE_UNAVAILABLE, 'MySQL driver (mysql2) is not installed. Run: npm install mysql2');
        }

        const createConn = mysql.createConnection ?? mysql.default?.createConnection;
        const connection = await createConn({
            host: config.host ?? 'localhost',
            port: config.port ?? 3306,
            database: config.database_name ?? undefined,
            user: creds.username,
            password: creds.password,
            ssl: config.ssl === 1 ? {} : undefined,
            connectTimeout: 10000,
        });

        try {
            const [rows, fields] = await connection.execute(sql, params);
            const columns = (fields as any[])?.map((f: any) => f.name) ?? [];
            return { rows: Array.isArray(rows) ? rows as Record<string, unknown>[] : [], columns };
        } finally {
            await connection.end().catch(() => { });
        }
    }

    private async querySqlite(
        creds: { filePath: string },
        sql: string,
        params: unknown[],
    ): Promise<{ rows: Record<string, unknown>[]; columns: string[] }> {
        // Use the already-imported Database constructor from the top-level import
        const Database = (await import('better-sqlite3-multiple-ciphers')).default;

        if (!creds.filePath) {
            throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'filePath is required for SQLite external databases');
        }

        const db = new Database(creds.filePath, { readonly: true });
        try {
            const stmt = db.prepare(sql);
            if (stmt.reader) {
                const rows = stmt.all(...params) as Record<string, unknown>[];
                const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
                return { rows, columns };
            } else {
                const info = stmt.run(...params);
                return { rows: [{ changes: info.changes, lastInsertRowid: info.lastInsertRowid }], columns: ['changes', 'lastInsertRowid'] };
            }
        } finally {
            db.close();
        }
    }
}
