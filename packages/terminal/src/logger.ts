/**
 * Terminal session log streaming and persistence.
 *
 * Captures PTY output to a ring buffer and optionally to disk,
 * enabling scrollback retrieval and session export.
 */

import { mkdirSync, createWriteStream, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WriteStream } from 'node:fs';
import type { Logger } from '@orch/daemon';
import type { TerminalSessionStore } from './sessions.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SessionLoggerOptions {
    /** Directory to store session log files. */
    logDir: string;
    /** Maximum scrollback buffer size in characters (default: 100_000). */
    maxScrollbackChars?: number;
    /** Whether to persist logs to disk (default: true). */
    persistToDisk?: boolean;
    /** Logger instance. */
    logger: Logger;
    /** Optional DB store for persisting session metadata. */
    sessionStore?: TerminalSessionStore;
}

export interface StartRecordingOptions {
    sessionId: string;
    owner: string;
    shell: string;
    cwd: string;
    cols: number;
    rows: number;
    profileId?: string;
}

interface SessionBuffer {
    buffer: string;
    fileStream: WriteStream | null;
    lineCount: number;
}

// ─── Implementation ─────────────────────────────────────────────────────────

export class SessionLogger {
    private readonly sessions = new Map<string, SessionBuffer>();
    private readonly logDir: string;
    private readonly maxChars: number;
    private readonly persistToDisk: boolean;
    private readonly logger: Logger;
    private readonly sessionStore?: TerminalSessionStore;

    constructor(options: SessionLoggerOptions) {
        this.logDir = options.logDir;
        this.maxChars = options.maxScrollbackChars ?? 100_000;
        this.persistToDisk = options.persistToDisk ?? true;
        this.logger = options.logger.child({ component: 'session-logger' });
        this.sessionStore = options.sessionStore;

        if (this.persistToDisk && !existsSync(this.logDir)) {
            mkdirSync(this.logDir, { recursive: true });
        }
    }

    /**
     * Start recording for a session.
     */
    startRecording(opts: StartRecordingOptions): void {
        const { sessionId } = opts;
        if (this.sessions.has(sessionId)) return;

        let fileStream: WriteStream | null = null;
        let logPath: string | undefined;

        if (this.persistToDisk) {
            logPath = join(this.logDir, `${sessionId}.log`);
            fileStream = createWriteStream(logPath, { flags: 'a' });
            fileStream.write(`--- Session ${sessionId} started at ${new Date().toISOString()} ---\n`);
        }

        this.sessions.set(sessionId, {
            buffer: '',
            fileStream,
            lineCount: 0,
        });

        // Persist metadata to DB if store is available
        this.sessionStore?.create({
            id: sessionId,
            owner: opts.owner,
            shell: opts.shell,
            cwd: opts.cwd,
            cols: opts.cols,
            rows: opts.rows,
            profileId: opts.profileId,
            logPath,
        });

        this.logger.debug({ sessionId }, 'Started recording session');
    }

    /**
     * Append data from PTY output.
     */
    appendData(sessionId: string, data: string): void {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        // Append to ring buffer with size cap
        session.buffer += data;
        if (session.buffer.length > this.maxChars) {
            session.buffer = session.buffer.slice(-this.maxChars);
        }

        // Count lines
        const newLines = (data.match(/\n/g) || []).length;
        session.lineCount += newLines;

        // Write to disk
        if (session.fileStream) {
            session.fileStream.write(data);
        }
    }

    /**
     * Get scrollback buffer content for a session.
     *
     * @param sessionId - Session to get scrollback for.
     * @param lines - If provided, return only the last N lines.
     * @returns Scrollback text, or empty string if session not found.
     */
    getScrollback(sessionId: string, lines?: number): string {
        const session = this.sessions.get(sessionId);
        if (!session) return '';

        if (lines === undefined) return session.buffer;

        const allLines = session.buffer.split('\n');
        return allLines.slice(-lines).join('\n');
    }

    /**
     * Stop recording and close file stream.
     */
    stopRecording(sessionId: string, exitCode?: number): void {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        if (session.fileStream) {
            session.fileStream.write(`\n--- Session ${sessionId} ended at ${new Date().toISOString()} ---\n`);
            session.fileStream.end();
        }

        this.sessions.delete(sessionId);
        this.sessionStore?.end(sessionId, exitCode ?? null);
        this.logger.debug({ sessionId, exitCode }, 'Stopped recording session');
    }

    /**
     * Read the full on-disk log for a session (past or present).
     * Returns null if no log file exists.
     */
    getLogContent(sessionId: string): string | null {
        const logPath = join(this.logDir, `${sessionId}.log`);
        if (!existsSync(logPath)) return null;
        try {
            return readFileSync(logPath, 'utf8');
        } catch {
            return null;
        }
    }

    /**
     * List all session log files on disk.
     */
    listLogFiles(): string[] {
        if (!existsSync(this.logDir)) return [];
        return readdirSync(this.logDir)
            .filter((f) => f.endsWith('.log'))
            .map((f) => f.replace('.log', ''));
    }

    /**
     * Clean up all sessions (shutdown).
     */
    shutdownAll(): void {
        for (const [id] of this.sessions) {
            this.stopRecording(id);
        }
    }
}
