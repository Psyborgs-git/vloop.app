/**
 * @orch/terminal — Cross-platform terminal/shell management via node-pty.
 */

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
export type { SessionLoggerOptions } from './logger.js';

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
