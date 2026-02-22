/**
 * LRP (Long-Running Process) spawner.
 *
 * Wraps Node.js child_process.spawn with environment isolation,
 * working directory control, and lifecycle events.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { OrchestratorError, ErrorCode } from '@orch/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SpawnOptions {
    /** Unique process identifier. */
    id: string;
    /** Command to execute. */
    command: string;
    /** Arguments for the command. */
    args?: string[];
    /** Working directory. */
    cwd?: string;
    /** Environment variables (merged with process.env). */
    env?: Record<string, string>;
    /** Run as specific UID (Linux/macOS only). */
    uid?: number;
    /** Run as specific GID (Linux/macOS only). */
    gid?: number;
    /** Shell to use (true = default shell, string = specific shell). */
    shell?: boolean | string;
}

export interface ProcessHandle {
    id: string;
    pid: number;
    process: ChildProcess;
    startedAt: string;
    command: string;
    args: string[];
    cwd: string;
}

export type ProcessExitEvent = {
    id: string;
    pid: number;
    exitCode: number | null;
    signal: string | null;
    oomKilled: boolean;
    timestamp: string;
};

// ─── Implementation ─────────────────────────────────────────────────────────

export class ProcessSpawner extends EventEmitter {
    /**
     * Spawn a new process.
     *
     * @returns ProcessHandle with PID and stream access
     */
    spawn(options: SpawnOptions): ProcessHandle {
        const {
            id, command, args = [], cwd = process.cwd(),
            env, uid, gid, shell = false,
        } = options;

        try {
            const child = spawn(command, args, {
                cwd,
                env: env ? { ...process.env, ...env } : process.env,
                uid: uid,
                gid: gid,
                shell,
                stdio: ['pipe', 'pipe', 'pipe'],
                detached: false,
            });

            if (!child.pid) {
                throw new OrchestratorError(
                    ErrorCode.PROCESS_ERROR,
                    `Failed to spawn process "${id}": no PID assigned`,
                    { id, command },
                );
            }

            const handle: ProcessHandle = {
                id,
                pid: child.pid,
                process: child,
                startedAt: new Date().toISOString(),
                command,
                args,
                cwd,
            };

            // Emit exit event when process terminates
            child.on('exit', (code, signal) => {
                const event: ProcessExitEvent = {
                    id,
                    pid: handle.pid,
                    exitCode: code,
                    signal: signal,
                    // Exit code 137 = killed by SIGKILL (usually OOM)
                    oomKilled: code === 137,
                    timestamp: new Date().toISOString(),
                };
                this.emit('exit', event);
            });

            child.on('error', (err) => {
                this.emit('error', {
                    id,
                    pid: handle.pid,
                    error: err.message,
                    timestamp: new Date().toISOString(),
                });
            });

            return handle;
        } catch (err) {
            if (err instanceof OrchestratorError) throw err;
            throw new OrchestratorError(
                ErrorCode.PROCESS_ERROR,
                `Failed to spawn process "${id}": ${err instanceof Error ? err.message : String(err)}`,
                { id, command, args },
            );
        }
    }

    /**
     * Send a signal to a process.
     */
    kill(handle: ProcessHandle, signal: NodeJS.Signals = 'SIGTERM'): boolean {
        try {
            return handle.process.kill(signal);
        } catch {
            return false;
        }
    }

    /**
     * Check if a process is still running.
     */
    isAlive(handle: ProcessHandle): boolean {
        try {
            // kill(0) doesn't actually send a signal, just checks if process exists
            process.kill(handle.pid, 0);
            return true;
        } catch {
            return false;
        }
    }
}
