/**
 * Tests for @orch/shared/types
 */

import { describe, it, expect } from 'vitest';
import { generateMessageId, generateTraceId, generateSessionId, now } from './types.js';

describe('ID generators', () => {
    it('generateMessageId returns a UUID string', () => {
        const id = generateMessageId();
        expect(typeof id).toBe('string');
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('generateMessageId returns unique values', () => {
        const ids = new Set(Array.from({ length: 100 }, () => generateMessageId()));
        expect(ids.size).toBe(100);
    });

    it('generateTraceId returns a 32-char hex string', () => {
        const id = generateTraceId();
        expect(typeof id).toBe('string');
        expect(id).toHaveLength(32);
        expect(id).toMatch(/^[0-9a-f]{32}$/);
    });

    it('generateSessionId returns a UUID string', () => {
        const id = generateSessionId();
        expect(typeof id).toBe('string');
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('now returns an ISO 8601 timestamp', () => {
        const ts = now();
        expect(typeof ts).toBe('string');
        // Should parse as valid date
        const parsed = new Date(ts);
        expect(parsed.getTime()).not.toBeNaN();
        // Should be within last second
        expect(Math.abs(Date.now() - parsed.getTime())).toBeLessThan(1000);
    });
});
