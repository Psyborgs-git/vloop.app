/**
 * Tests for @orch/daemon/protocol — Request/Response parsing & serialization
 */

import { describe, it, expect } from 'vitest';
import { parseRequest, serializeResponse, buildErrorResponse, buildResultResponse } from './protocol.js';
import type { Response } from './protocol.js';
import { OrchestratorError, ErrorCode } from '@orch/shared';

describe('parseRequest', () => {
    const validRequest = {
        id: 'test-id-123',
        topic: 'vault',
        action: 'secret.get',
        payload: { name: 'my-secret' },
        meta: {
            timestamp: '2026-01-01T00:00:00.000Z',
            trace_id: 'abc123',
        },
    };

    it('should parse a valid JSON request', () => {
        const req = parseRequest(JSON.stringify(validRequest), 'json');
        expect(req.id).toBe('test-id-123');
        expect(req.topic).toBe('vault');
        expect(req.action).toBe('secret.get');
        expect(req.payload).toEqual({ name: 'my-secret' });
        expect(req.meta.trace_id).toBe('abc123');
    });

    it('should parse a valid JSON request from Buffer', () => {
        const buf = Buffer.from(JSON.stringify(validRequest));
        const req = parseRequest(buf, 'json');
        expect(req.id).toBe('test-id-123');
    });

    it('should throw MALFORMED_MESSAGE for invalid JSON', () => {
        expect(() => parseRequest('not-json!!', 'json')).toThrow('Failed to parse message');
    });

    it('should throw MALFORMED_MESSAGE for missing required fields', () => {
        const incomplete = JSON.stringify({ id: 'test' });
        expect(() => parseRequest(incomplete, 'json')).toThrow('Invalid request envelope');
    });

    it('should throw MALFORMED_MESSAGE for empty id', () => {
        const invalid = JSON.stringify({ ...validRequest, id: '' });
        expect(() => parseRequest(invalid, 'json')).toThrow('Invalid request envelope');
    });

    it('should default payload to {} when missing', () => {
        const noPayload = { ...validRequest };
        delete (noPayload as Record<string, unknown>)['payload'];
        const req = parseRequest(JSON.stringify(noPayload), 'json');
        expect(req.payload).toEqual({});
    });
});

describe('serializeResponse', () => {
    const response: Response = {
        id: 'resp-1',
        type: 'result',
        topic: 'vault',
        action: 'secret.get',
        payload: { value: 'secret-value' },
        meta: { timestamp: '2026-01-01T00:00:00.000Z' },
    };

    it('should serialize to JSON string', () => {
        const result = serializeResponse(response, 'json');
        expect(typeof result).toBe('string');
        const parsed = JSON.parse(result as string);
        expect(parsed.id).toBe('resp-1');
        expect(parsed.type).toBe('result');
        expect(parsed.payload.value).toBe('secret-value');
    });

    it('should serialize to MessagePack buffer', () => {
        const result = serializeResponse(response, 'msgpack');
        expect(Buffer.isBuffer(result)).toBe(true);
        expect((result as Buffer).length).toBeGreaterThan(0);
    });
});

describe('buildErrorResponse', () => {
    it('should build a well-formed error response', () => {
        const err = new OrchestratorError(ErrorCode.PERMISSION_DENIED, 'Nope');
        const resp = buildErrorResponse('req-1', 'vault', 'secret.get', err, 'trace-1');

        expect(resp.id).toBe('req-1');
        expect(resp.type).toBe('error');
        expect(resp.topic).toBe('vault');
        expect(resp.meta.trace_id).toBe('trace-1');
        expect((resp.payload as Record<string, unknown>).code).toBe('PERMISSION_DENIED');
    });
});

describe('buildResultResponse', () => {
    it('should build a well-formed result response', () => {
        const resp = buildResultResponse('req-2', 'health', 'check', { status: 'ok' }, 'trace-2');

        expect(resp.id).toBe('req-2');
        expect(resp.type).toBe('result');
        expect(resp.topic).toBe('health');
        expect((resp.payload as Record<string, unknown>).status).toBe('ok');
        expect(resp.meta.trace_id).toBe('trace-2');
    });
});
