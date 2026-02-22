/**
 * WebSocket message protocol — Request/Response envelope types.
 *
 * All client↔server communication uses these standardised envelopes.
 * Supports both JSON (text frames) and MessagePack (binary frames).
 */

import { z } from 'zod';
import { encode, decode } from '@msgpack/msgpack';
import { OrchestratorError, ErrorCode } from '@orch/shared';

// ─── Type Definitions ────────────────────────────────────────────────────────

export type ResponseType = 'result' | 'error' | 'stream' | 'event';

export interface RequestMeta {
    session_id?: string;
    timestamp: string;
    trace_id?: string;
}

export interface ResponseMeta {
    timestamp: string;
    trace_id?: string;
    /** Sequence number for streaming responses. */
    seq?: number;
}

export interface Request {
    /** Client-generated correlation ID. */
    id: string;
    /** Feature domain (e.g., "container", "process", "agent", "vault"). */
    topic: string;
    /** Operation (e.g., "create", "list", "stop"). */
    action: string;
    /** Action-specific payload. */
    payload: unknown;
    /** Request metadata. */
    meta: RequestMeta;
}

export interface Response {
    /** Echoed correlation ID from the request. */
    id: string;
    /** Response type. */
    type: ResponseType;
    /** Echoed topic. */
    topic: string;
    /** Echoed action. */
    action: string;
    /** Response payload. */
    payload: unknown;
    /** Response metadata. */
    meta: ResponseMeta;
}

// ─── Zod Validation ──────────────────────────────────────────────────────────

const RequestSchema = z.object({
    id: z.string().min(1),
    topic: z.string().min(1),
    action: z.string().min(1),
    payload: z.unknown().default({}),
    meta: z.object({
        session_id: z.string().optional(),
        timestamp: z.string(),
        trace_id: z.string().optional(),
    }),
});

// ─── Serialization ───────────────────────────────────────────────────────────

export type SubProtocol = 'json' | 'msgpack';

/**
 * Parse an inbound WebSocket message into a validated Request.
 */
export function parseRequest(
    data: Buffer | string,
    subprotocol: SubProtocol,
): Request {
    let raw: unknown;

    try {
        if (subprotocol === 'msgpack') {
            raw = decode(typeof data === 'string' ? Buffer.from(data) : data);
        } else {
            raw = JSON.parse(typeof data === 'string' ? data : data.toString('utf-8'));
        }
    } catch {
        throw new OrchestratorError(
            ErrorCode.MALFORMED_MESSAGE,
            'Failed to parse message — invalid JSON or MessagePack.',
        );
    }

    const result = RequestSchema.safeParse(raw);
    if (!result.success) {
        const issues = result.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join(', ');

        throw new OrchestratorError(
            ErrorCode.MALFORMED_MESSAGE,
            `Invalid request envelope: ${issues}`,
        );
    }

    return result.data as Request;
}

/**
 * Serialize a Response for outbound WebSocket transmission.
 */
export function serializeResponse(
    response: Response,
    subprotocol: SubProtocol,
): Buffer | string {
    if (subprotocol === 'msgpack') {
        return Buffer.from(encode(response));
    }
    return JSON.stringify(response);
}

/**
 * Build an error Response from an OrchestratorError and a request context.
 */
export function buildErrorResponse(
    requestId: string,
    topic: string,
    action: string,
    error: OrchestratorError,
    traceId?: string,
): Response {
    return {
        id: requestId,
        type: 'error',
        topic,
        action,
        payload: error.toPayload(),
        meta: {
            timestamp: new Date().toISOString(),
            trace_id: traceId,
        },
    };
}

/**
 * Build a success Result Response.
 */
export function buildResultResponse(
    requestId: string,
    topic: string,
    action: string,
    payload: unknown,
    traceId?: string,
): Response {
    return {
        id: requestId,
        type: 'result',
        topic,
        action,
        payload,
        meta: {
            timestamp: new Date().toISOString(),
            trace_id: traceId,
        },
    };
}
