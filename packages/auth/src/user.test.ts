import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3-multiple-ciphers';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { UserManager } from './user.js';

describe('UserManager', () => {
    let tempDir: string;
    let db: InstanceType<typeof Database>;
    let userManager: UserManager;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'orch-user-test-'));
        db = new Database(join(tempDir, 'test.db'));
        userManager = new UserManager(db, drizzle(db));
    });

    afterEach(() => {
        db.close();
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('creates a user and returns it', async () => {
        const user = await userManager.create('alice@example.com', ['admin', 'viewer']);
        expect(user.id).toBeDefined();
        expect(user.email).toBe('alice@example.com');
        expect(user.allowedRoles).toEqual(['admin', 'viewer']);
        expect(user.createdAt).toBeDefined();
    });

    it('rejects duplicate email', async () => {
        await userManager.create('dup@example.com', ['viewer']);
        await expect(userManager.create('dup@example.com', ['admin'])).rejects.toThrow();
    });

    it('finds a user by email', async () => {
        await userManager.create('find@example.com', ['viewer']);
        const row = userManager.findByEmail('find@example.com');
        expect(row).toBeDefined();
        expect(row!.email).toBe('find@example.com');
    });

    it('returns undefined for unknown email', () => {
        expect(userManager.findByEmail('ghost@example.com')).toBeUndefined();
    });

    it('verifies correct password', async () => {
        await userManager.create('pw@example.com', ['viewer'], 'secret123');
        const user = await userManager.verifyPassword('pw@example.com', 'secret123');
        expect(user.email).toBe('pw@example.com');
    });

    it('rejects wrong password', async () => {
        await userManager.create('pw2@example.com', ['viewer'], 'correct');
        await expect(userManager.verifyPassword('pw2@example.com', 'wrong')).rejects.toThrow();
    });

    it('rejects password check for user without a password', async () => {
        await userManager.create('nopass@example.com', ['viewer']);
        await expect(userManager.verifyPassword('nopass@example.com', 'anything')).rejects.toThrow();
    });

    it('updates roles', async () => {
        await userManager.create('roles@example.com', ['viewer']);
        const updated = userManager.updateRoles('roles@example.com', ['admin', 'viewer']);
        expect(updated.allowedRoles).toEqual(['admin', 'viewer']);
    });

    it('throws when updating roles for non-existent user', () => {
        expect(() => userManager.updateRoles('ghost@example.com', ['admin'])).toThrow();
    });

    it('updates password and verifies new one', async () => {
        await userManager.create('chpw@example.com', ['viewer'], 'old-pass');
        await userManager.updatePassword('chpw@example.com', 'new-pass');
        const user = await userManager.verifyPassword('chpw@example.com', 'new-pass');
        expect(user.email).toBe('chpw@example.com');
        await expect(userManager.verifyPassword('chpw@example.com', 'old-pass')).rejects.toThrow();
    });

    it('counts users', async () => {
        expect(userManager.count()).toBe(0);
        await userManager.create('a@example.com', []);
        await userManager.create('b@example.com', []);
        expect(userManager.count()).toBe(2);
    });

    it('initialises default admin when count is zero', async () => {
        expect(userManager.count()).toBe(0);
        await userManager.initDefaultUser();
        expect(userManager.count()).toBe(1);
        const admin = userManager.findByEmail('admin');
        expect(admin).toBeDefined();
    });

    it('skips default user init when users already exist', async () => {
        await userManager.create('existing@example.com', []);
        await userManager.initDefaultUser();
        expect(userManager.count()).toBe(1);
    });

    it('lists users with pagination', async () => {
        for (let i = 0; i < 12; i++) {
            await userManager.create(`user${i}@example.com`, ['viewer']);
        }

        const page1 = userManager.list({ limit: 5, offset: 0 });
        expect(page1.total).toBe(12);
        expect(page1.items).toHaveLength(5);
        expect(page1.limit).toBe(5);
        expect(page1.offset).toBe(0);

        const page2 = userManager.list({ limit: 5, offset: 5 });
        expect(page2.items).toHaveLength(5);

        const page3 = userManager.list({ limit: 5, offset: 10 });
        expect(page3.items).toHaveLength(2);

        const allIds = [...page1.items, ...page2.items, ...page3.items].map(u => u.id);
        expect(new Set(allIds).size).toBe(12);
    });
});
