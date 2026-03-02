import { randomUUID } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';
import type { RootDatabaseOrm } from '@orch/shared/db';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { PaginationOptions, PaginatedResult } from '@orch/shared';
import { eq, sql, desc } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

const jwtProvidersTable = sqliteTable('jwt_providers', {
    id: text('id').primaryKey(),
    issuer: text('issuer').notNull(),
    jwks_url: text('jwks_url').notNull(),
    audience: text('audience').notNull(),
    created_at: text('created_at').notNull(),
});

export interface JwtProvider {
    id: string;
    issuer: string;
    jwksUrl: string;
    audience: string;
    createdAt: string;
}

interface JwtProviderRow {
    id: string;
    issuer: string;
    jwks_url: string;
    audience: string;
    created_at: string;
}

export class JwtProviderManager {
    private db: BetterSqlite3.Database;
    private orm: RootDatabaseOrm;

    constructor(db: BetterSqlite3.Database, orm: RootDatabaseOrm) {
        this.db = db;
        this.orm = orm;
        this.initSchema();
    }

    private initSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS jwt_providers (
                id TEXT PRIMARY KEY,
                issuer TEXT NOT NULL UNIQUE,
                jwks_url TEXT NOT NULL,
                audience TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_jwt_providers_issuer ON jwt_providers(issuer);
            CREATE INDEX IF NOT EXISTS idx_jwt_providers_created_at ON jwt_providers(created_at DESC);
        `);
    }

    /**
     * Add a new JWT provider.
     */
    add(issuer: string, jwksUrl: string, audience: string): JwtProvider {
        const id = randomUUID();
        const now = new Date().toISOString();

        try {
            this.orm
                .insert(jwtProvidersTable)
                .values({
                    id,
                    issuer,
                    jwks_url: jwksUrl,
                    audience,
                    created_at: now,
                })
                .run();
        } catch (err: any) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                throw new OrchestratorError(
                    ErrorCode.INTERNAL_ERROR,
                    `JWT Provider with issuer ${issuer} already exists.`
                );
            }
            throw err;
        }

        return {
            id,
            issuer,
            jwksUrl,
            audience,
            createdAt: now,
        };
    }

    /**
     * Find a JWT provider by issuer.
     */
    findByIssuer(issuer: string): JwtProviderRow | undefined {
        return this.orm
            .select()
            .from(jwtProvidersTable)
            .where(eq(jwtProvidersTable.issuer, issuer))
            .get() as JwtProviderRow | undefined;
    }

    /**
     * Remove a JWT provider.
     */
    remove(issuer: string): void {
        const result = this.orm
            .delete(jwtProvidersTable)
            .where(eq(jwtProvidersTable.issuer, issuer))
            .run();
        if (result.changes === 0) {
            throw new OrchestratorError(ErrorCode.NOT_FOUND, `JWT Provider with issuer ${issuer} not found.`);
        }
    }

    /**
     * List all JWT providers.
     */
    list(options: PaginationOptions = {}): PaginatedResult<JwtProvider> {
        const limit = options.limit ?? 50;
        const offset = options.offset ?? 0;

        const countRow = this.orm
            .select({ count: sql<number>`count(*)` })
            .from(jwtProvidersTable)
            .get() as { count: number } | undefined;
        const total = countRow?.count ?? 0;

        const rows = this.orm
            .select()
            .from(jwtProvidersTable)
            .orderBy(desc(jwtProvidersTable.created_at))
            .limit(limit)
            .offset(offset)
            .all() as JwtProviderRow[];
        const items = rows.map(row => ({
            id: row.id,
            issuer: row.issuer,
            jwksUrl: row.jwks_url,
            audience: row.audience,
            createdAt: row.created_at,
        }));

        return { items, total, limit, offset };
    }
}
