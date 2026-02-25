/**
 * Tests for @orch/auth/audit — tamper-evident audit logger
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3-multiple-ciphers';
import { AuditLogger } from './audit.js';

describe('AuditLogger', () => {
    let tempDir: string;
    let db: InstanceType<typeof Database>;
    let audit: AuditLogger;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'orch-audit-test-'));
        db = new Database(join(tempDir, 'test.db'));
        audit = new AuditLogger(db);
    });

    afterEach(() => {
        db.close();
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('should log an audit entry', () => {
        audit.log({
            identity: 'admin@test.com',
            topic: 'vault',
            action: 'secret.create',
            outcome: 'allowed',
        });

        const entries = audit.query().items;
        expect(entries).toHaveLength(1);
        expect(entries[0]!.identity).toBe('admin@test.com');
        expect(entries[0]!.topic).toBe('vault');
        expect(entries[0]!.action).toBe('secret.create');
        expect(entries[0]!.outcome).toBe('allowed');
        expect(entries[0]!.entryHash).toBeDefined();
    });

    it('should maintain hash chain integrity', () => {
        audit.log({ identity: 'user1', topic: 'a', action: 'b', outcome: 'allowed' });
        audit.log({ identity: 'user2', topic: 'c', action: 'd', outcome: 'denied' });
        audit.log({ identity: 'user3', topic: 'e', action: 'f', outcome: 'allowed' });

        const entries = audit.query({ limit: 10 }).items;
        expect(entries).toHaveLength(3);

        // Each entry should have a unique hash
        const hashes = entries.map((e) => e.entryHash);
        expect(new Set(hashes).size).toBe(3);
    });

    it('should filter by identity', () => {
        audit.log({ identity: 'alice', topic: 'vault', action: 'get', outcome: 'allowed' });
        audit.log({ identity: 'bob', topic: 'vault', action: 'get', outcome: 'allowed' });
        audit.log({ identity: 'alice', topic: 'container', action: 'create', outcome: 'allowed' });

        const aliceEntries = audit.query({ identity: 'alice' }).items;
        expect(aliceEntries).toHaveLength(2);
        expect(aliceEntries.every((e) => e.identity === 'alice')).toBe(true);
    });

    it('should filter by outcome', () => {
        audit.log({ identity: 'user', topic: 'vault', action: 'get', outcome: 'allowed' });
        audit.log({ identity: 'user', topic: 'vault', action: 'delete', outcome: 'denied' });

        const denied = audit.query({ outcome: 'denied' }).items;
        expect(denied).toHaveLength(1);
        expect(denied[0]!.action).toBe('delete');
    });

    it('should filter by topic', () => {
        audit.log({ identity: 'user', topic: 'vault', action: 'get', outcome: 'allowed' });
        audit.log({ identity: 'user', topic: 'container', action: 'create', outcome: 'allowed' });

        const vaultEntries = audit.query({ topic: 'vault' }).items;
        expect(vaultEntries).toHaveLength(1);
    });

    it('should support pagination', () => {
        for (let i = 0; i < 10; i++) {
            audit.log({
                identity: `user-${i}`,
                topic: 'test',
                action: 'do',
                outcome: 'allowed',
            });
        }

        const page1 = audit.query({ limit: 3, offset: 0 }).items;
        const page2 = audit.query({ limit: 3, offset: 3 }).items;

        expect(page1).toHaveLength(3);
        expect(page2).toHaveLength(3);
        // Should not overlap
        const ids1 = page1.map((e) => e.id);
        const ids2 = page2.map((e) => e.id);
        expect(ids1.some((id) => ids2.includes(id))).toBe(false);
    });
});
