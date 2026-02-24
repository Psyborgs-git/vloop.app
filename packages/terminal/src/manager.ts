/**
 * Terminal Manager — PTY session lifecycle management.
 *
 * Spawns cross-platform pseudoterminal processes via node-pty,
 * manages active sessions, and emits data/exit events.
 */

import { EventEmitter } from 'node:events';
import * as pty from 'node-pty';
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

        const shell = options.shell ?? detectDefaultShell();
        const cols = options.cols ?? 80;
        const rows = options.rows ?? 24;
        const cwd = options.cwd ?? process.env['HOME'] ?? '/';
        const args = options.args ?? [];

        const env: Record<string, string> = {
            ...(process.env as Record<string, string>),
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
            ...options.env,
        };

        this.logger.info(
            { sessionId: options.sessionId, shell, cols, rows, cwd },
            `Spawning terminal session: ${options.sessionId}`,
        );

        const ptyProcess = pty.spawn(shell, args, {
            name: 'xterm-256color',
            cols,
            rows,
            cwd,
            env,
        });

        const info: TerminalSessionInfo = {
            sessionId: options.sessionId,
            pid: ptyProcess.pid,
            shell,
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
}
