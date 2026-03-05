import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { PaginationOptions, PaginatedResult } from '@orch/shared';
import { desc, eq, sql } from 'drizzle-orm';
import { usersTable, initAuthSchema } from './schema.js';
import type { RootDatabaseOrm } from '@orch/shared/db';

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
    private orm: RootDatabaseOrm;

    constructor(db: { exec(sql: string): unknown }, orm: RootDatabaseOrm) {
        initAuthSchema(db);
        this.orm = orm;
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
            this.orm.insert(usersTable).values({
                id,
                email,
                password_hash: passwordHash,
                allowed_roles: JSON.stringify(allowedRoles),
                created_at: now,
            }).run();
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
        return this.orm.select().from(usersTable).where(eq(usersTable.email, email)).get() as UserRow | undefined;
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
        const result = this.orm
            .update(usersTable)
            .set({ allowed_roles: JSON.stringify(allowedRoles) })
            .where(eq(usersTable.email, email))
            .run();

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
        const result = this.orm
            .update(usersTable)
            .set({ password_hash: passwordHash })
            .where(eq(usersTable.email, email))
            .run();

        if (result.changes === 0) {
            throw new OrchestratorError(ErrorCode.NOT_FOUND, `User with email ${email} not found.`);
        }
    }

    /**
     * Count total users.
     */
    count(): number {
        const row = this.orm.select({ count: sql<number>`count(*)` }).from(usersTable).get() as { count: number };
        return row.count;
    }

    /**
     * List all users.
     */
    list(options: PaginationOptions = {}): PaginatedResult<User> {
        const limit = options.limit ?? 50;
        const offset = options.offset ?? 0;

        const countRow = this.orm.select({ count: sql<number>`count(*)` }).from(usersTable).get() as { count: number };
        const total = countRow.count;

        const rows = this.orm
            .select()
            .from(usersTable)
            .orderBy(desc(usersTable.created_at), desc(usersTable.id))
            .limit(limit)
            .offset(offset)
            .all() as UserRow[];
        const items = rows.map(row => ({
            id: row.id,
            email: row.email,
            allowedRoles: JSON.parse(row.allowed_roles),
            createdAt: row.created_at,
        }));

        return { items, total, limit, offset };
    }
}
