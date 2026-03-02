export enum ErrorCode {
    MALFORMED_MESSAGE = 'MALFORMED_MESSAGE',
    UNKNOWN_TOPIC = 'UNKNOWN_TOPIC',
    UNKNOWN_ACTION = 'UNKNOWN_ACTION',
    MESSAGE_TOO_LARGE = 'MESSAGE_TOO_LARGE',
    AUTH_REQUIRED = 'AUTH_REQUIRED',
    AUTH_FAILED = 'AUTH_FAILED',
    TOKEN_EXPIRED = 'TOKEN_EXPIRED',
    TOKEN_INVALID = 'TOKEN_INVALID',
    SESSION_EXPIRED = 'SESSION_EXPIRED',
    SESSION_REVOKED = 'SESSION_REVOKED',
    MAX_SESSIONS_EXCEEDED = 'MAX_SESSIONS_EXCEEDED',
    PERMISSION_DENIED = 'PERMISSION_DENIED',
    VAULT_LOCKED = 'VAULT_LOCKED',
    VAULT_WRONG_PASSPHRASE = 'VAULT_WRONG_PASSPHRASE',
    SECRET_NOT_FOUND = 'SECRET_NOT_FOUND',
    SECRET_ALREADY_EXISTS = 'SECRET_ALREADY_EXISTS',
    CONFIG_INVALID = 'CONFIG_INVALID',
    CONFIG_NOT_FOUND = 'CONFIG_NOT_FOUND',
    CONFIG_VALIDATION_FAILED = 'CONFIG_VALIDATION_FAILED',
    DB_ERROR = 'DB_ERROR',
    DB_ENCRYPTION_FAILED = 'DB_ENCRYPTION_FAILED',
    DOCKER_UNAVAILABLE = 'DOCKER_UNAVAILABLE',
    CONTAINER_ERROR = 'CONTAINER_ERROR',
    PROCESS_ERROR = 'PROCESS_ERROR',
    PROCESS_NOT_FOUND = 'PROCESS_NOT_FOUND',
    SCHEDULE_ERROR = 'SCHEDULE_ERROR',
    TERMINAL_ERROR = 'TERMINAL_ERROR',
    NOT_FOUND = 'NOT_FOUND',
    ALREADY_EXISTS = 'ALREADY_EXISTS',
    VALIDATION_ERROR = 'VALIDATION_ERROR',
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
        Object.setPrototypeOf(this, new.target.prototype);
    }
}