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
    const opts: pino.LoggerOptions = {
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
    };

    // pretty‑print to the terminal when running in development or when
    // explicitly requested. the environment variable avoids pulling in the
    // transport in production containers, but we still include pino-pretty in
    // devDependencies so tests and dev runs work.
    if (process.env.NODE_ENV !== 'production' || process.env.PINO_PRETTY) {
        opts.transport = {
            target: 'pino-pretty',
            options: {
                colorize: true,
                ignore: 'pid,hostname',
                translateTime: true,
            },
        };
    }

    return pino(opts);
}
