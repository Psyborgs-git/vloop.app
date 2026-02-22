/**
 * Tests for @orch/shared/errors
 */

import { describe, it, expect } from 'vitest';
import { OrchestratorError, ErrorCode } from './errors.js';

describe('OrchestratorError', () => {
    it('should create an error with code and message', () => {
        const err = new OrchestratorError(ErrorCode.INTERNAL_ERROR, 'Something failed');
        expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
        expect(err.message).toBe('Something failed');
        expect(err.name).toBe('OrchestratorError');
        expect(err.timestamp).toBeDefined();
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(OrchestratorError);
    });

    it('should include details when provided', () => {
        const details = { path: '/foo', reason: 'not_found' };
        const err = new OrchestratorError(ErrorCode.CONFIG_NOT_FOUND, 'Not found', details);
        expect(err.details).toEqual(details);
    });

    it('should serialize to payload correctly', () => {
        const err = new OrchestratorError(ErrorCode.AUTH_FAILED, 'Bad token', { hint: 'expired' });
        const payload = err.toPayload();
        expect(payload.code).toBe('AUTH_FAILED');
        expect(payload.message).toBe('Bad token');
        expect(payload.details).toEqual({ hint: 'expired' });
        expect(payload.timestamp).toBeDefined();
    });

    it('should serialize without details if not provided', () => {
        const err = new OrchestratorError(ErrorCode.INTERNAL_ERROR, 'Oops');
        const payload = err.toPayload();
        expect(payload.details).toBeUndefined();
    });

    describe('OrchestratorError.from()', () => {
        it('should return the same OrchestratorError if already one', () => {
            const original = new OrchestratorError(ErrorCode.VAULT_LOCKED, 'Locked');
            const wrapped = OrchestratorError.from(original);
            expect(wrapped).toBe(original);
        });

        it('should wrap a standard Error', () => {
            const original = new Error('native error');
            const wrapped = OrchestratorError.from(original);
            expect(wrapped.code).toBe(ErrorCode.INTERNAL_ERROR);
            expect(wrapped.message).toBe('native error');
            expect(wrapped.details?.stack).toBeDefined();
        });

        it('should wrap a string value', () => {
            const wrapped = OrchestratorError.from('string error');
            expect(wrapped.code).toBe(ErrorCode.INTERNAL_ERROR);
            expect(wrapped.message).toBe('string error');
        });

        it('should wrap a number value', () => {
            const wrapped = OrchestratorError.from(42);
            expect(wrapped.code).toBe(ErrorCode.INTERNAL_ERROR);
            expect(wrapped.message).toBe('42');
        });
    });
});
