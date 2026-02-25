import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { PaginationOptions, PaginatedResult } from '@orch/shared';

export interface User {
    id: string;
    email: string;
    allowedRoles: string[];
    createdAt: string;
}

interface UserRow {
    id: string;
    email: string;
    password_hash: string | null;
    allowed_roles: string;
    created_at: string;
}

export class UserManager {
    private db: BetterSqlite3.Database;

    constructor(db: BetterSqlite3.Database) {
        this.db = db;
        this.initSchema();
    }

    private initSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT,
                allowed_roles TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);
        `);
    }

    /**
     * Initialize the default admin user if the database is empty.
     */
    async initDefaultUser(): Promise<void> {
        if (this.count() === 0) {
            await this.create('admin', ['admin'], 'password');
        }
    }

    /**
     * Create a new user.
     */
    async create(email: string, allowedRoles: string[], password?: string): Promise<User> {
        const id = randomUUID();
        const now = new Date().toISOString();
        let passwordHash: string | null = null;

        if (password) {
            passwordHash = await bcrypt.hash(password, 10);
        }

        try {
            this.db.prepare(`
                INSERT INTO users (id, email, password_hash, allowed_roles, created_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(id, email, passwordHash, JSON.stringify(allowedRoles), now);
        } catch (err: any) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                throw new OrchestratorError(
                    ErrorCode.INTERNAL_ERROR,
                    `User with email ${email} already exists.`
                );
            }
            throw err;
        }

        return {
            id,
            email,
            allowedRoles,
            createdAt: now,
        };
    }

    /**
     * Find a user by email.
     */
    findByEmail(email: string): UserRow | undefined {
        return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
    }

    /**
     * Verify a user's password.
     */
    async verifyPassword(email: string, password: string): Promise<User> {
        const user = this.findByEmail(email);
        if (!user || !user.password_hash) {
            throw new OrchestratorError(ErrorCode.AUTH_FAILED, 'Invalid email or password.');
        }

        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
            throw new OrchestratorError(ErrorCode.AUTH_FAILED, 'Invalid email or password.');
        }

        return {
            id: user.id,
            email: user.email,
            allowedRoles: JSON.parse(user.allowed_roles),
            createdAt: user.created_at,
        };
    }

    /**
     * Update a user's allowed roles.
     */
    updateRoles(email: string, allowedRoles: string[]): User {
        const result = this.db.prepare('UPDATE users SET allowed_roles = ? WHERE email = ?').run(
            JSON.stringify(allowedRoles),
            email
        );

        if (result.changes === 0) {
            throw new OrchestratorError(ErrorCode.NOT_FOUND, `User with email ${email} not found.`);
        }

        const user = this.findByEmail(email)!;
        return {
            id: user.id,
            email: user.email,
            allowedRoles: JSON.parse(user.allowed_roles),
            createdAt: user.created_at,
        };
    }

    /**
     * Update a user's password.
     */
    async updatePassword(email: string, newPassword: string): Promise<void> {
        const passwordHash = await bcrypt.hash(newPassword, 10);
        const result = this.db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(
            passwordHash,
            email
        );

        if (result.changes === 0) {
            throw new OrchestratorError(ErrorCode.NOT_FOUND, `User with email ${email} not found.`);
        }
    }

    /**
     * Count total users.
     */
    count(): number {
        const row = this.db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
        return row.count;
    }

    /**
     * List all users.
     */
    list(options: PaginationOptions = {}): PaginatedResult<User> {
        const limit = options.limit ?? 50;
        const offset = options.offset ?? 0;

        const countRow = this.db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
        const total = countRow.count;

        const rows = this.db.prepare('SELECT * FROM users ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?').all(limit, offset) as UserRow[];
        const items = rows.map(row => ({
            id: row.id,
            email: row.email,
            allowedRoles: JSON.parse(row.allowed_roles),
            createdAt: row.created_at,
        }));

        return { items, total, limit, offset };
    }
}
