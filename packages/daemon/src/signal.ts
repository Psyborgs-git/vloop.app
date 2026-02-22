/**
 * OS signal handling for graceful shutdown and config reload.
 *
 * - SIGTERM / SIGINT → graceful shutdown (drain connections, flush state, exit 0)
 * - SIGHUP → reload configuration
 *
 * Cross-platform: SIGHUP is not available on Windows, so we skip it there.
 */

import type { Logger } from './logging.js';

export interface SignalHandlers {
    /** AbortController that fires on shutdown signals. */
    shutdownController: AbortController;
    /** Register a callback for config reload (SIGHUP). */
    onReload(callback: () => void): void;
}

export function setupSignalHandlers(logger: Logger): SignalHandlers {
    const shutdownController = new AbortController();
    const reloadCallbacks: Array<() => void> = [];

    const shutdown = (signal: string) => {
        logger.info({ signal }, `Received ${signal} — initiating graceful shutdown`);
        shutdownController.abort();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // SIGHUP is not available on Windows
    if (process.platform !== 'win32') {
        process.on('SIGHUP', () => {
            logger.info('Received SIGHUP — reloading configuration');
            for (const cb of reloadCallbacks) {
                try {
                    cb();
                } catch (err) {
                    logger.error({ err }, 'Error during config reload callback');
                }
            }
        });
    }

    // Global unhandled rejection / exception safety net
    process.on('unhandledRejection', (reason) => {
        logger.error({ err: reason }, 'Unhandled promise rejection');
    });

    process.on('uncaughtException', (err) => {
        logger.fatal({ err }, 'Uncaught exception — shutting down');
        shutdownController.abort();
        // Give async handlers a moment to flush
        setTimeout(() => process.exit(1), 1000);
    });

    return {
        shutdownController,
        onReload(callback: () => void) {
            reloadCallbacks.push(callback);
        },
    };
}
