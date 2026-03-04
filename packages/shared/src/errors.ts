/**
 * Unified error types for the Orchestrator System.
 *
 * All errors across all feature packages extend OrchestratorError,
 * providing consistent error codes and structured error payloads.
 */

export enum ErrorCode {
    // Protocol errors
    MALFORMED_MESSAGE = 'MALFORMED_MESSAGE',
    UNKNOWN_TOPIC = 'UNKNOWN_TOPIC',
    UNKNOWN_ACTION = 'UNKNOWN_ACTION',
    MESSAGE_TOO_LARGE = 'MESSAGE_TOO_LARGE',

    // Auth errors
    AUTH_REQUIRED = 'AUTH_REQUIRED',
    AUTH_FAILED = 'AUTH_FAILED',
    TOKEN_EXPIRED = 'TOKEN_EXPIRED',
    TOKEN_INVALID = 'TOKEN_INVALID',
    SESSION_EXPIRED = 'SESSION_EXPIRED',
    SESSION_REVOKED = 'SESSION_REVOKED',
    MAX_SESSIONS_EXCEEDED = 'MAX_SESSIONS_EXCEEDED',
    TOKEN_REVOKED = 'TOKEN_REVOKED',
    TOKEN_SCOPE_INSUFFICIENT = 'TOKEN_SCOPE_INSUFFICIENT',
    MAX_TOKENS_EXCEEDED = 'MAX_TOKENS_EXCEEDED',

    // RBAC errors
    PERMISSION_DENIED = 'PERMISSION_DENIED',

    // Vault errors
    VAULT_LOCKED = 'VAULT_LOCKED',
    VAULT_WRONG_PASSPHRASE = 'VAULT_WRONG_PASSPHRASE',
    SECRET_NOT_FOUND = 'SECRET_NOT_FOUND',
    SECRET_ALREADY_EXISTS = 'SECRET_ALREADY_EXISTS',

    // Config errors
    CONFIG_INVALID = 'CONFIG_INVALID',
    CONFIG_NOT_FOUND = 'CONFIG_NOT_FOUND',
    CONFIG_VALIDATION_FAILED = 'CONFIG_VALIDATION_FAILED',

    // Database errors
    DB_ERROR = 'DB_ERROR',
    DB_ENCRYPTION_FAILED = 'DB_ENCRYPTION_FAILED',

    // Container errors
    DOCKER_UNAVAILABLE = 'DOCKER_UNAVAILABLE',
    CONTAINER_ERROR = 'CONTAINER_ERROR',

    // Process errors
    PROCESS_ERROR = 'PROCESS_ERROR',
    PROCESS_NOT_FOUND = 'PROCESS_NOT_FOUND',
    SCHEDULE_ERROR = 'SCHEDULE_ERROR',

    // Terminal errors
    TERMINAL_ERROR = 'TERMINAL_ERROR',

    // General errors
    NOT_FOUND = 'NOT_FOUND',
    ALREADY_EXISTS = 'ALREADY_EXISTS',
    VALIDATION_ERROR = 'VALIDATION_ERROR',

    // System errors
    INTERNAL_ERROR = 'INTERNAL_ERROR',
    SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
    CONNECTION_LIMIT_EXCEEDED = 'CONNECTION_LIMIT_EXCEEDED',
}

export class OrchestratorError extends Error {
    public readonly code: ErrorCode;
    public readonly details?: Record<string, unknown>;
    public readonly timestamp: string;

    constructor(
        code: ErrorCode,
        message: string,
        details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = 'OrchestratorError';
        this.code = code;
        this.details = details;
        this.timestamp = new Date().toISOString();

        // Maintain proper prototype chain
        Object.setPrototypeOf(this, new.target.prototype);
    }

    /**
     * Serialize error for WebSocket response payload.
     */
    toPayload(): Record<string, unknown> {
        return {
            code: this.code,
            message: this.message,
            ...(this.details ? { details: this.details } : {}),
            timestamp: this.timestamp,
        };
    }

    /**
     * Create from an unknown caught value — always returns OrchestratorError.
     */
    static from(err: unknown): OrchestratorError {
        if (err instanceof OrchestratorError) {
            return err;
        }
        if (err instanceof Error) {
            return new OrchestratorError(
                ErrorCode.INTERNAL_ERROR,
                err.message,
                { stack: err.stack },
            );
        }
        return new OrchestratorError(
            ErrorCode.INTERNAL_ERROR,
            String(err),
        );
    }
}
