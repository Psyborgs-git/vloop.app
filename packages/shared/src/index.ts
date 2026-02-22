/**
 * @orch/shared — Cross-cutting utilities for the Orchestrator System.
 *
 * Provides unified error types, common type definitions, and the
 * encrypted SQLite database helper used by all feature packages.
 */

export { OrchestratorError, ErrorCode } from './errors.js';
export type { MessageId, Timestamp, TraceId, SessionId } from './types.js';
export { generateMessageId, generateTraceId, generateSessionId, now } from './types.js';
