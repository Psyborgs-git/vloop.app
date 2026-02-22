/**
 * Structured logging via Pino.
 *
 * All logs are JSON-formatted for machine parsing and systemd journal.
 * Child loggers are used to bind request-scoped fields (trace_id, session_id).
 */

import pino from 'pino';

export type Logger = pino.Logger;
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Create the root logger for the daemon.
 */
export function createLogger(level: LogLevel = 'info'): Logger {
    return pino({
        level,
        name: 'orchestrator',
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
            level(label) {
                return { level: label };
            },
        },
        // Serializers for common objects
        serializers: {
            err: pino.stdSerializers.err,
            req: pino.stdSerializers.req,
            res: pino.stdSerializers.res,
        },
    });
}
