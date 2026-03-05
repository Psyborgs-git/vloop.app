/**
 * Tests for @orch/terminal/sessions — TerminalSessionStore CRUD + list
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3-multiple-ciphers';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { TerminalSessionStore } from './sessions.js';

function createLoggerStub() {
    const base = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(),
    };
    base.child.mockReturnValue(base);
    return base;
}

describe('TerminalSessionStore', () => {
    let tempDir: string;
    let db: InstanceType<typeof Database>;
    let store: TerminalSessionStore;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'orch-terminal-sessions-test-'));
        db = new Database(join(tempDir, 'test.db'));
        const orm = drizzle(db);
        store = new TerminalSessionStore(db, orm, createLoggerStub() as any);
    });

    afterEach(() => {
        db.close();
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('creates a session record', () => {
        store.create({
            id: 'sess-1',
            owner: 'user@example.com',
            shell: '/bin/bash',
            cwd: '/home/user',
            cols: 80,
            rows: 24,
        });

        const record = store.get('sess-1');
        expect(record).toBeDefined();
        expect(record!.id).toBe('sess-1');
        expect(record!.owner).toBe('user@example.com');
        expect(record!.shell).toBe('/bin/bash');
        expect(record!.cwd).toBe('/home/user');
        expect(record!.cols).toBe(80);
        expect(record!.rows).toBe(24);
        expect(record!.endedAt).toBeNull();
        expect(record!.exitCode).toBeNull();
    });

    it('creates a session with optional profileId and logPath', () => {
        store.create({
            id: 'sess-2',
            owner: 'user@example.com',
            shell: '/usr/bin/zsh',
            cwd: '/tmp',
            cols: 120,
            rows: 40,
            profileId: 'profile-42',
            logPath: '/var/log/sessions/sess-2.log',
        });

        const record = store.get('sess-2');
        expect(record!.profileId).toBe('profile-42');
        expect(record!.logPath).toBe('/var/log/sessions/sess-2.log');
    });

    it('ends a session and records exit code', () => {
        store.create({ id: 'sess-3', owner: 'user@example.com', shell: '/bin/sh', cwd: '/', cols: 80, rows: 24 });
        store.end('sess-3', 0);

        const record = store.get('sess-3');
        expect(record!.exitCode).toBe(0);
        expect(record!.endedAt).toBeDefined();
        expect(record!.endedAt).not.toBeNull();
    });

    it('ends a session with non-zero exit code', () => {
        store.create({ id: 'sess-4', owner: 'user@example.com', shell: '/bin/sh', cwd: '/', cols: 80, rows: 24 });
        store.end('sess-4', 127);

        const record = store.get('sess-4');
        expect(record!.exitCode).toBe(127);
    });

    it('ends a session with null exit code (signal kill)', () => {
        store.create({ id: 'sess-5', owner: 'user@example.com', shell: '/bin/sh', cwd: '/', cols: 80, rows: 24 });
        store.end('sess-5', null);

        const record = store.get('sess-5');
        expect(record!.exitCode).toBeNull();
        expect(record!.endedAt).not.toBeNull();
    });

    it('returns undefined for non-existent session', () => {
        expect(store.get('nonexistent-id')).toBeUndefined();
    });

    it('lists all sessions when no owner filter is given', () => {
        store.create({ id: 's-a', owner: 'alice@example.com', shell: '/bin/bash', cwd: '/', cols: 80, rows: 24 });
        store.create({ id: 's-b', owner: 'bob@example.com', shell: '/bin/zsh', cwd: '/', cols: 80, rows: 24 });
        store.create({ id: 's-c', owner: 'alice@example.com', shell: '/bin/sh', cwd: '/', cols: 80, rows: 24 });

        const result = store.list();
        expect(result.total).toBe(3);
        expect(result.items).toHaveLength(3);
    });

    it('filters sessions by owner', () => {
        store.create({ id: 's-a', owner: 'alice@example.com', shell: '/bin/bash', cwd: '/', cols: 80, rows: 24 });
        store.create({ id: 's-b', owner: 'bob@example.com', shell: '/bin/zsh', cwd: '/', cols: 80, rows: 24 });

        const alice = store.list('alice@example.com');
        expect(alice.total).toBe(1);
        expect(alice.items[0].owner).toBe('alice@example.com');

        const bob = store.list('bob@example.com');
        expect(bob.total).toBe(1);
        expect(bob.items[0].id).toBe('s-b');
    });

    it('supports pagination', () => {
        for (let i = 0; i < 7; i++) {
            store.create({ id: `sess-${i}`, owner: 'user@example.com', shell: '/bin/sh', cwd: '/', cols: 80, rows: 24 });
        }

        const page1 = store.list('user@example.com', { limit: 3, offset: 0 });
        expect(page1.total).toBe(7);
        expect(page1.items).toHaveLength(3);

        const page2 = store.list('user@example.com', { limit: 3, offset: 3 });
        expect(page2.items).toHaveLength(3);

        const page3 = store.list('user@example.com', { limit: 3, offset: 6 });
        expect(page3.items).toHaveLength(1);
    });

    it('returns most recent sessions first', () => {
        store.create({ id: 'old', owner: 'user@example.com', shell: '/bin/sh', cwd: '/', cols: 80, rows: 24 });
        // Backdate the 'old' record so 'new' has the later timestamp
        const pastDate = new Date(Date.now() - 60000).toISOString();
        db.prepare('UPDATE terminal_sessions SET started_at = ? WHERE id = ?').run(pastDate, 'old');

        store.create({ id: 'new', owner: 'user@example.com', shell: '/bin/bash', cwd: '/', cols: 80, rows: 24 });

        const result = store.list('user@example.com');
        // Most recent first — 'new' has current time, 'old' has time 60s in the past
        expect(result.items[0].id).toBe('new');
    });
});
