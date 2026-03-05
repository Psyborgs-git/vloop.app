/**
 * Tests for @orch/auth/jwt-provider — JwtProviderManager CRUD
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3-multiple-ciphers';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { JwtProviderManager } from './jwt-provider.js';

describe('JwtProviderManager', () => {
    let tempDir: string;
    let db: InstanceType<typeof Database>;
    let mgr: JwtProviderManager;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'orch-jwtprov-test-'));
        db = new Database(join(tempDir, 'test.db'));
        const orm = drizzle(db);
        mgr = new JwtProviderManager(db, orm);
    });

    afterEach(() => {
        db.close();
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('adds a provider and returns structured data', () => {
        const p = mgr.add(
            'https://accounts.example.com',
            'https://accounts.example.com/.well-known/jwks.json',
            'https://api.vloop.app',
        );

        expect(p.id).toBeDefined();
        expect(p.issuer).toBe('https://accounts.example.com');
        expect(p.jwksUrl).toBe('https://accounts.example.com/.well-known/jwks.json');
        expect(p.audience).toBe('https://api.vloop.app');
        expect(p.createdAt).toBeDefined();
    });

    it('finds a provider by issuer', () => {
        mgr.add('https://id.example.com', 'https://id.example.com/jwks', 'aud1');

        const row = mgr.findByIssuer('https://id.example.com');
        expect(row).toBeDefined();
        expect(row!.issuer).toBe('https://id.example.com');
        expect(row!.jwks_url).toBe('https://id.example.com/jwks');
    });

    it('returns undefined for unknown issuer', () => {
        expect(mgr.findByIssuer('https://unknown.example.com')).toBeUndefined();
    });

    it('rejects duplicate issuer', () => {
        mgr.add('https://dup.example.com', 'https://dup.example.com/jwks', 'aud');
        expect(() =>
            mgr.add('https://dup.example.com', 'https://dup.example.com/jwks', 'aud'),
        ).toThrow();
    });

    it('removes a provider', () => {
        mgr.add('https://remove.example.com', 'https://remove.example.com/jwks', 'aud');
        mgr.remove('https://remove.example.com');
        expect(mgr.findByIssuer('https://remove.example.com')).toBeUndefined();
    });

    it('throws when removing a non-existent provider', () => {
        expect(() => mgr.remove('https://ghost.example.com')).toThrow();
    });

    it('lists providers with pagination', () => {
        for (let i = 0; i < 5; i++) {
            mgr.add(`https://issuer${i}.example.com`, `https://issuer${i}.example.com/jwks`, 'aud');
        }

        const page1 = mgr.list({ limit: 3, offset: 0 });
        expect(page1.total).toBe(5);
        expect(page1.items).toHaveLength(3);
        expect(page1.limit).toBe(3);
        expect(page1.offset).toBe(0);

        const page2 = mgr.list({ limit: 3, offset: 3 });
        expect(page2.items).toHaveLength(2);

        const allIds = [...page1.items, ...page2.items].map((p) => p.id);
        expect(new Set(allIds).size).toBe(5);
    });

    it('returns empty list when no providers exist', () => {
        const result = mgr.list();
        expect(result.items).toHaveLength(0);
        expect(result.total).toBe(0);
    });
});
