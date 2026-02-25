/**
 * Common types and ID generators for the Orchestrator System.
 */

// Browser and Node 22+ Crypto API handles random values

// ─── Branded Types ───────────────────────────────────────────────────────────

/**
 * Branded type pattern for compile-time type safety on IDs.
 * Prevents accidentally passing a SessionId where a MessageId is expected.
 */
type Brand<T, B extends string> = T & { readonly __brand: B };

/** Client-generated correlation ID for request/response matching. */
export type MessageId = Brand<string, 'MessageId'>;

/** ISO 8601 timestamp string. */
export type Timestamp = Brand<string, 'Timestamp'>;

/** Distributed trace identifier for observability. */
export type TraceId = Brand<string, 'TraceId'>;

/** Session identifier assigned on successful authentication. */
export type SessionId = Brand<string, 'SessionId'>;

// ─── Pagination Types ────────────────────────────────────────────────────────

/** Options for paginating list queries. */
export interface PaginationOptions {
    /** Maximum number of items to return. Defaults to 50. */
    limit?: number;
    /** Number of items to skip. Defaults to 0. */
    offset?: number;
}

/** Standard paginated result structure. */
export interface PaginatedResult<T> {
    /** The list of items on the current page. */
    items: T[];
    /** Total number of items available across all pages. */
    total: number;
    /** The limit applied to this query. */
    limit: number;
    /** The offset applied to this query. */
    offset: number;
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a new MessageId (UUID v4). */
export function generateMessageId(): MessageId {
    return crypto.randomUUID() as MessageId;
}

/** Generate a new TraceId (32-char hex string). */
export function generateTraceId(): TraceId {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    const hex = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
    return hex as TraceId;
}

/** Generate a new SessionId (UUID v4). */
export function generateSessionId(): SessionId {
    return crypto.randomUUID() as SessionId;
}

/** Current time as ISO 8601 Timestamp. */
export function now(): Timestamp {
    return new Date().toISOString() as Timestamp;
}
