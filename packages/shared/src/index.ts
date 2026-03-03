/**
 * @orch/shared — Cross-cutting utilities for the Orchestrator System.
 *
 * Provides unified error types, common type definitions, and the
 * encrypted SQLite database helper used by all feature packages.
 */

export { OrchestratorError, ErrorCode } from './errors.js';
export type { MessageId, Timestamp, TraceId, SessionId } from './types.js';
export type { PaginationOptions, PaginatedResult } from './types.js';
export { generateMessageId, generateTraceId, generateSessionId, now } from './types.js';
export * from './app/index.js';
export { TOKENS } from './tokens.js';
export type {
    OrchestratorConfig,
    DaemonSectionConfig,
    NetworkSectionConfig,
    TlsSectionConfig,
    AuthSectionConfig,
    DatabaseSectionConfig,
    VaultSectionConfig,
    ContainerdSectionConfig,
    StorageSectionConfig,
    ApplicationsSectionConfig,
    TerminalSectionConfig,
    DbManagerSectionConfig,
    AiAgentSectionConfig,
} from './config.js';
export { resolveConfig } from './config.js';
