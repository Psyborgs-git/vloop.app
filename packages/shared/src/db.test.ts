/**
 * Tests for @orch/shared/db — encrypted SQLite
 */

import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseManager } from './db.js';
import { ErrorCode } from './errors.js';

describe('DatabaseManager', () => {
    let tempDir: string;
    let dbPath: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'orch-db-test-'));
        dbPath = join(tempDir, 'test.db');
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('should open an encrypted database and create it if not exists', () => {
        const mgr = new DatabaseManager({ path: dbPath, passphrase: 'test-pass-123' });
        const db = mgr.open();
        expect(db).toBeDefined();
        expect(mgr.isOpen()).toBe(true);
        mgr.close();
        expect(mgr.isOpen()).toBe(false);
    });

    it('should return the same db instance on repeated open() calls', () => {
        const mgr = new DatabaseManager({ path: dbPath, passphrase: 'pass' });
        const db1 = mgr.open();
        const db2 = mgr.open();
        expect(db1).toBe(db2);
        mgr.close();
    });

    it('should run migrations successfully', () => {
        const mgr = new DatabaseManager({ path: dbPath, passphrase: 'pass' });
        mgr.open();
        mgr.migrate(`
      CREATE TABLE test_table (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      );
    `);

        const db = mgr.getDb();
        db.prepare('INSERT INTO test_table (name) VALUES (?)').run('hello');
        const row = db.prepare('SELECT name FROM test_table WHERE id = 1').get() as { name: string };
        expect(row.name).toBe('hello');

        mgr.close();
    });

    it('should reject wrong passphrase on re-open', () => {
        // Create DB with correct passphrase
        const mgr1 = new DatabaseManager({ path: dbPath, passphrase: 'correct-pass' });
        mgr1.open();
        mgr1.migrate('CREATE TABLE t(id INTEGER PRIMARY KEY)');
        mgr1.close();

        // Try to open with wrong passphrase
        const mgr2 = new DatabaseManager({ path: dbPath, passphrase: 'wrong-pass' });
        expect(() => mgr2.open()).toThrow();
    });

    it('should throw when calling getDb() before open()', () => {
        const mgr = new DatabaseManager({ path: dbPath, passphrase: 'pass' });
        expect(() => mgr.getDb()).toThrow('Database is not open');
    });

    it('should expose drizzle orm after open()', () => {
        const mgr = new DatabaseManager({ path: dbPath, passphrase: 'pass' });
        mgr.open();
        const orm = mgr.getOrm();
        expect(orm).toBeDefined();
        mgr.close();
    });

    it('should reject non-sqlite root engine during staged migration', () => {
        const mgr = new DatabaseManager({
            engine: 'postgres',
            path: dbPath,
            passphrase: 'pass',
        });

        expect(() => mgr.open()).toThrow("Database engine 'postgres' is not available");
    });

    it('should create parent directories if they do not exist', () => {
        const deepPath = join(tempDir, 'nested', 'dir', 'test.db');
        const mgr = new DatabaseManager({ path: deepPath, passphrase: 'pass' });
        mgr.open();
        expect(mgr.isOpen()).toBe(true);
        mgr.close();
    });
});
