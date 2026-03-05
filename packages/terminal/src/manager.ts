/**
 * Terminal Manager — PTY session lifecycle management.
 *
 * Spawns cross-platform pseudoterminal processes via node-pty,
 * manages active sessions, and emits data/exit events.
 */

import { EventEmitter } from 'node:events';
import * as pty from 'node-pty';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Logger } from '@orch/daemon';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TerminalSpawnOptions {
    /** Unique session identifier. */
    sessionId: string;
    /** Shell executable (auto-detected if omitted). */
    shell?: string;
    /** Shell arguments. */
    args?: string[];
    /** Working directory. */
    cwd?: string;
    /** Environment variables (merged with process.env). */
    env?: Record<string, string>;
    /** Terminal columns (default: 80). */
    cols?: number;
    /** Terminal rows (default: 24). */
    rows?: number;
    /** Owner identity (for access control). */
    owner: string;
    /** Profile ID that spawned this session. */
    profileId?: string;
}

export interface TerminalSessionInfo {
    sessionId: string;
    pid: number;
    shell: string;
    cwd: string;
    cols: number;
    rows: number;
    owner: string;
    profileId?: string;
    startedAt: string;
}

export interface TerminalSession {
    info: TerminalSessionInfo;
    pty: pty.IPty;
}

// ─── Shell Detection ─────────────────────────────────────────────────────────

function detectDefaultShell(): string {
    if (process.platform === 'win32') {
        return process.env['COMSPEC'] || 'powershell.exe';
    }
    return process.env['SHELL'] || '/bin/bash';
}

// ─── Manager Implementation ─────────────────────────────────────────────────

export class TerminalManager extends EventEmitter {
    private readonly sessions = new Map<string, TerminalSession>();
    private readonly logger: Logger;

    constructor(logger: Logger) {
        super();
        this.logger = logger.child({ component: 'terminal-manager' });
    }

    /**
     * Spawn a new PTY session.
     *
     * @returns Session info for the newly created terminal.
     * @throws If session ID already exists.
     */
    spawn(options: TerminalSpawnOptions): TerminalSessionInfo {
        if (this.sessions.has(options.sessionId)) {
            throw new Error(`Terminal session already exists: ${options.sessionId}`);
        }

        const preferredShell = options.shell ?? detectDefaultShell();
        const cols = options.cols ?? 80;
        const rows = options.rows ?? 24;
        // treat empty string as unspecified so we fall back to HOME
        let cwd = options.cwd && options.cwd.length > 0 ? options.cwd : undefined;
        cwd = cwd ?? process.env['HOME'] ?? '/';
        const args = options.args ?? [];

        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) {
            if (typeof value === 'string') {
                env[key] = value;
            }
        }
        for (const [key, value] of Object.entries(options.env ?? {})) {
            if (typeof value === 'string') {
                env[key] = value;
            }
        }
        env.TERM = 'xterm-256color';
        env.COLORTERM = 'truecolor';

        // validate the working directory before spawning
        try {
            // ensure path exists and is a directory
            const stat = fs.statSync(cwd);
            if (!stat.isDirectory()) {
                throw new Error('not a directory');
            }
        } catch (err: any) {
            // throw a clearer error to caller
            throw new Error(
                `Invalid working directory "${cwd}": ${err.message}`,
            );
        }

        this.logger.info(
            { sessionId: options.sessionId, shell: preferredShell, cols, rows, cwd },
            `Spawning terminal session: ${options.sessionId}`,
        );

        const shellCandidates = this.resolveShellCandidates(preferredShell);

        let ptyProcess: pty.IPty | undefined;
        let selectedShell = preferredShell;
        let lastError: unknown;

        // helper that runs the actual spawn attempt for each candidate and provides retry
        const trySpawn = (): boolean => {
            for (const shellCandidate of shellCandidates) {
                try {
                    ptyProcess = pty.spawn(shellCandidate, args, {
                        name: 'xterm-256color',
                        cols,
                        rows,
                        cwd,
                        env,
                    });
                    selectedShell = shellCandidate;
                    return true;
                } catch (err) {
                    lastError = err;
                    this.logger.warn(
                        {
                            sessionId: options.sessionId,
                            shell: shellCandidate,
                            cwd,
                            err: err instanceof Error ? err.message : String(err),
                        },
                        'Terminal spawn attempt failed; trying fallback shell',
                    );
                }
            }
            return false;
        };

        // first attempt, possibly repairing permissions on failure
        let attemptedRepair = false;
        if (!trySpawn()) {
            const reason = lastError instanceof Error ? lastError.message : String(lastError);
            if (!attemptedRepair && reason.includes('posix_spawnp')) {
                // this is often caused by missing execute permissions on the
                // node-pty prebuilt binaries.  attempt to fix and retry once.
                this.logger.warn(
                    { sessionId: options.sessionId, cwd, err: reason },
                    'posix_spawnp failed, attempting to repair node-pty permissions and retry',
                );
                attemptedRepair = true;
                this.fixPtyPermissions();
                // reset lastError and try again
                lastError = undefined;
                if (!trySpawn()) {
                    // fall through to error handling below
                } else {
                    // success on retry
                }
            }
        }

        if (!ptyProcess) {
            const reason = lastError instanceof Error ? lastError.message : String(lastError);
            this.logger.error(
                { sessionId: options.sessionId, cwd, err: reason },
                'Failed to spawn terminal session',
            );
            throw new Error(`Failed to spawn terminal: ${reason}`);
        }

        if (!ptyProcess) {
            const reason = lastError instanceof Error ? lastError.message : String(lastError);
            this.logger.error(
                { sessionId: options.sessionId, cwd, err: reason },
                'Failed to spawn terminal session',
            );
            throw new Error(`Failed to spawn terminal: ${reason}`);
        }

        const info: TerminalSessionInfo = {
            sessionId: options.sessionId,
            pid: ptyProcess.pid,
            shell: selectedShell,
            cwd,
            cols,
            rows,
            owner: options.owner,
            profileId: options.profileId,
            startedAt: new Date().toISOString(),
        };

        const session: TerminalSession = { info, pty: ptyProcess };
        this.sessions.set(options.sessionId, session);

        // Wire PTY events → manager events
        ptyProcess.onData((data: string) => {
            this.emit('data', options.sessionId, data);
        });

        ptyProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
            this.logger.info(
                { sessionId: options.sessionId, exitCode, signal },
                `Terminal session exited: ${options.sessionId}`,
            );
            this.sessions.delete(options.sessionId);
            this.emit('exit', options.sessionId, exitCode, signal);
        });

        this.logger.info(
            { sessionId: options.sessionId, pid: ptyProcess.pid },
            `Terminal session spawned: ${options.sessionId}`,
        );

        return info;
    }

    /**
     * Write data (user input) to a terminal session.
     */
    write(sessionId: string, data: string): void {
        const session = this.getSession(sessionId);
        session.pty.write(data);
    }

    /**
     * Resize a terminal session.
     */
    resize(sessionId: string, cols: number, rows: number): void {
        const session = this.getSession(sessionId);
        session.pty.resize(cols, rows);
        session.info.cols = cols;
        session.info.rows = rows;
        this.logger.debug({ sessionId, cols, rows }, 'Terminal resized');
    }

    /**
     * Kill a terminal session.
     */
    kill(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (!session) return; // Already dead — no-op

        this.logger.info({ sessionId }, `Killing terminal session: ${sessionId}`);
        session.pty.kill();
        this.sessions.delete(sessionId);
    }

    /**
     * List all active terminal sessions.
     */
    list(): TerminalSessionInfo[] {
        return Array.from(this.sessions.values()).map((s) => s.info);
    }

    /**
     * Get a specific session by ID.
     */
    get(sessionId: string): TerminalSessionInfo | undefined {
        return this.sessions.get(sessionId)?.info;
    }

    /**
     * Count of sessions owned by a specific identity.
     */
    countByOwner(owner: string): number {
        let count = 0;
        for (const s of this.sessions.values()) {
            if (s.info.owner === owner) count++;
        }
        return count;
    }

    /**
     * Shutdown all sessions (used during daemon shutdown).
     */
    shutdownAll(): void {
        this.logger.info({ count: this.sessions.size }, 'Shutting down all terminal sessions');
        for (const [id] of this.sessions) {
            this.kill(id);
        }
    }

    /**
     * Internal helper — get session or throw.
     */
    private getSession(sessionId: string): TerminalSession {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Terminal session not found: ${sessionId}`);
        }
        return session;
    }

    /**
     * When node-pty binaries lose their execute bit (often during unpacking on
     * certain platforms) we get a confusing `posix_spawnp failed` error at
     * runtime.  The root package includes a build-time script to fix this, but
     * the problem can still surface if permissions are wrong after installation
     * (for example in CI or container images).  This helper mirrors the logic
     * from `scripts/fix-pty-permissions.mjs` so it can be invoked on-demand by
     * the manager and automatically retries spawning the shell.
     */
    private fixPtyPermissions(): void {
        try {
            const pkgJson = require.resolve('node-pty/package.json');
            const prebuildsDir = path.join(path.dirname(pkgJson), 'prebuilds');
            if (!fs.existsSync(prebuildsDir)) {
                return;
            }
            for (const arch of fs.readdirSync(prebuildsDir)) {
                const archDir = path.join(prebuildsDir, arch);
                if (!fs.statSync(archDir).isDirectory()) continue;
                for (const file of fs.readdirSync(archDir)) {
                    const filePath = path.join(archDir, file);
                    try {
                        fs.chmodSync(filePath, 0o755);
                    } catch {
                        // ignore permission errors
                    }
                }
            }
            this.logger.info({ component: 'terminal-manager' }, 'Repaired node-pty prebuild permissions');
        } catch {
            // if anything goes wrong we silently ignore as it's a best-effort fix
        }
    }

    private resolveShellCandidates(preferred: string): string[] {
        const candidates: string[] = [];

        const add = (value: string | undefined) => {
            if (!value || candidates.includes(value)) return;

            // absolute paths should exist and be executable
            if (value.startsWith('/')) {
                try {
                    if (!fs.existsSync(value)) return;
                    fs.accessSync(value, fs.constants.X_OK);
                } catch {
                    return;
                }
            }

            candidates.push(value);
        };

        add(preferred);
        add(process.env['SHELL']);

        if (process.platform === 'win32') {
            add(process.env['COMSPEC']);
            add('powershell.exe');
            add('cmd.exe');
        } else {
            add('/bin/zsh');
            add('/bin/bash');
            add('/bin/sh');
        }

        // Guarantee at least one attempt.
        if (candidates.length === 0) {
            candidates.push(preferred || detectDefaultShell());
        }

        return candidates;
    }
}
