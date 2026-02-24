import { randomUUID } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';
import { OrchestratorError, ErrorCode } from '@orch/shared';

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

    constructor(db: BetterSqlite3.Database) {
        this.db = db;
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
        `);
    }

    /**
     * Add a new JWT provider.
     */
    add(issuer: string, jwksUrl: string, audience: string): JwtProvider {
        const id = randomUUID();
        const now = new Date().toISOString();

        try {
            this.db.prepare(`
                INSERT INTO jwt_providers (id, issuer, jwks_url, audience, created_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(id, issuer, jwksUrl, audience, now);
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
        return this.db.prepare('SELECT * FROM jwt_providers WHERE issuer = ?').get(issuer) as JwtProviderRow | undefined;
    }

    /**
     * Remove a JWT provider.
     */
    remove(issuer: string): void {
        const result = this.db.prepare('DELETE FROM jwt_providers WHERE issuer = ?').run(issuer);
        if (result.changes === 0) {
            throw new OrchestratorError(ErrorCode.NOT_FOUND, `JWT Provider with issuer ${issuer} not found.`);
        }
    }

    /**
     * List all JWT providers.
     */
    list(): JwtProvider[] {
        const rows = this.db.prepare('SELECT * FROM jwt_providers ORDER BY created_at DESC').all() as JwtProviderRow[];
        return rows.map(row => ({
            id: row.id,
            issuer: row.issuer,
            jwksUrl: row.jwks_url,
            audience: row.audience,
            createdAt: row.created_at,
        }));
    }
}
