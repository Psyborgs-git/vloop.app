import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3-multiple-ciphers';
import { UserManager } from './user.js';

describe('UserManager', () => {
    let tempDir: string;
    let db: InstanceType<typeof Database>;
    let userManager: UserManager;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'orch-user-test-'));
        db = new Database(join(tempDir, 'test.db'));
        userManager = new UserManager(db);
    });

    afterEach(() => {
        db.close();
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('should list users with pagination', async () => {
        // Create 25 users
        for (let i = 0; i < 25; i++) {
            // Add slight delay to ensure unique timestamps for deterministic ordering
            await new Promise(resolve => setTimeout(resolve, 10));
            await userManager.create(`user${i}@example.com`, ['viewer']);
        }

        const page1 = userManager.list({ limit: 10, offset: 0 });
        expect(page1.items).toHaveLength(10);
        expect(page1.total).toBe(25);
        expect(page1.limit).toBe(10);
        expect(page1.offset).toBe(0);

        const page2 = userManager.list({ limit: 10, offset: 10 });
        expect(page2.items).toHaveLength(10);
        // Verify different items
        const ids1 = new Set(page1.items.map(u => u.id));
        const ids2 = new Set(page2.items.map(u => u.id));
        for (const id of ids2) {
            expect(ids1.has(id)).toBe(false);
        }

        const page3 = userManager.list({ limit: 10, offset: 20 });
        expect(page3.items).toHaveLength(5);
        expect(page3.total).toBe(25);
    });
});
