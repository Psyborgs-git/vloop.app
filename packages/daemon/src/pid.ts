import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';
import type { Logger } from './logging.js';

/**
 * Read a PID from the given file.  Returns `null` when the file doesn't
 * exist or contains something that isn't a valid positive integer.
 */
export async function readPidFile(pidFile: string): Promise<number | null> {
    try {
        const raw = await fs.readFile(pidFile, 'utf8');
        const num = parseInt(raw.trim(), 10);
        if (Number.isNaN(num) || num <= 0) return null;
        return num;
    } catch (err: any) {
        if (err.code === 'ENOENT') return null;
        throw err;
    }
}

/**
 * Write the current process PID to the supplied path.  Must be called after
 * any existing pid file has been cleared. Returns true if successful, false if
 * permission denied (non-fatal error).
 */
export async function writePidFile(pidFile: string): Promise<boolean> {
    try {
        // ensure parent directory exists
        await fs.mkdir(dirname(pidFile), { recursive: true }).catch(() => {});
        await fs.writeFile(pidFile, String(process.pid), { encoding: 'utf8' });
        return true;
    } catch (err: any) {
        // if permission denied, silently fail (non-fatal for dev environments)
        if (err.code === 'EACCES') {
            return false;
        }
        throw err;
    }
}

/**
 * Remove a pid file if it exists.  This is safe to call multiple times.
 */
export async function removePidFile(pidFile: string): Promise<void> {
    try {
        await fs.unlink(pidFile);
    } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
    }
}

/**
 * If a pid file exists and points to a running process, attempt to terminate
 * that process and wait briefly for it to exit.  The pid file is removed in
 * all cases so the caller can safely write a fresh entry.
 *
 * @param pidFile path configured under `[daemon].pid_file`
 * @param logger optional logger instance for informational messages
 */
export async function killExistingDaemon(pidFile: string, logger?: Logger): Promise<void> {
    let existingPid: number | null = null;
    try {
        existingPid = await readPidFile(pidFile);
    } catch (err) {
        // if we could not even read the file (permission etc) bubble up
        throw err;
    }

    if (existingPid && existingPid !== process.pid) {
        try {
            // check if the process is alive
            process.kill(existingPid, 0);
            logger?.info({ pid: existingPid }, 'Detected running daemon, sending SIGTERM');
            try {
                process.kill(existingPid, 'SIGTERM');
            } catch {
                // if it fails for some reason ignore; we still wait below
            }

            // wait a short while for it to terminate
            const start = Date.now();
            while (Date.now() - start < 2000) {
                try {
                    process.kill(existingPid, 0);
                    // still alive
                    await new Promise((r) => setTimeout(r, 100));
                } catch {
                    // process no longer exists
                    break;
                }
            }
        } catch {
            logger?.info({ pid: existingPid }, 'no process with that pid, ignoring');
        }
    }

    // always attempt to delete the pid file so a fresh write may follow
    try {
        await removePidFile(pidFile);
    } catch (err: any) {
        logger?.warn({ err, pidFile }, 'failed to delete stale pid file');
    }
}

/**
 * Attempt to kill any process listening on the given port(s).
 * This is a best-effort fallback when PID file is not available.
 * Only works on macOS/Linux with `lsof` available.
 */
export async function killProcessesOnPorts(ports: number[], logger?: Logger): Promise<void> {
    if (process.platform === 'win32') return; // Not implemented for Windows

    for (const port of ports) {
        try {
            // Use lsof to find processes listening on the port
            const output = execSync(`lsof -ti:${port}`, { encoding: 'utf8' }).trim();
            if (!output) continue;

            const pids = output.split('\n').map((line) => parseInt(line.trim(), 10));
            for (const pid of pids) {
                if (pid && !isNaN(pid) && pid !== process.pid) {
                    logger?.info({ port, pid }, 'Terminating conflicting process on port');
                    try {
                        process.kill(pid, 'SIGTERM');
                    } catch {
                        // ignore if process doesn't exist
                    }
                }
            }

            // Give processes time to terminate gracefully
            await new Promise((r) => setTimeout(r, 300));

            // If still occupied, use SIGKILL
            try {
                const stillRunning = execSync(`lsof -ti:${port}`, { encoding: 'utf8' }).trim();
                if (stillRunning) {
                    const stillPids = stillRunning.split('\n').map((line) => parseInt(line.trim(), 10));
                    for (const pid of stillPids) {
                        if (pid && !isNaN(pid) && pid !== process.pid) {
                            logger?.warn({ port, pid }, 'Force killing process on port (SIGKILL)');
                            try {
                                process.kill(pid, 'SIGKILL');
                            } catch {
                                // ignore if process doesn't exist
                            }
                        }
                    }
                    await new Promise((r) => setTimeout(r, 200));
                }
            } catch {
                // port is likely free now
            }
        } catch {
            // lsof not available or port is free, continue
        }
    }
    
    // Give final time for all cleanup
    await new Promise((r) => setTimeout(r, 300));
}
