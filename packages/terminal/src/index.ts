/**
 * @orch/terminal — Cross-platform terminal/shell management via node-pty.
 */

export { terminalSchema, initTerminalSchema } from './schema.js';

export { TerminalManager } from './manager.js';
export type {
    TerminalSpawnOptions,
    TerminalSessionInfo,
    TerminalSession,
} from './manager.js';

export { TerminalProfileManager } from './profiles.js';
export type {
    TerminalProfile,
    CreateProfileInput,
    UpdateProfileInput,
} from './profiles.js';

export { SessionLogger } from './logger.js';
export type { SessionLoggerOptions, StartRecordingOptions } from './logger.js';

export { TerminalSessionStore } from './sessions.js';
export type { TerminalSessionRecord } from './sessions.js';

export {
    checkAccess,
    validateShell,
    validateInput,
    DEFAULT_TERMINAL_POLICY,
} from './permissions.js';
export type {
    TerminalPolicy,
    AccessCheckResult,
} from './permissions.js';

export { createTerminalHandler } from './handler.js';
