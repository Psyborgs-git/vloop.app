/**
 * Container log streaming.
 *
 * Attach to container stdout/stderr and stream structured log events.
 */

import type { DockerClient } from './docker.js';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { Readable } from 'node:stream';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LogOptions {
    /** Follow live output (default: false). */
    follow?: boolean;
    /** Return logs since this timestamp (ISO 8601). */
    since?: string;
    /** Number of tail lines to return (default: all). */
    tail?: number;
    /** Include stdout (default: true). */
    stdout?: boolean;
    /** Include stderr (default: true). */
    stderr?: boolean;
}

export interface LogEntry {
    stream: 'stdout' | 'stderr';
    timestamp: string;
    line: string;
}

export type LogCallback = (entry: LogEntry) => void;

// ─── Implementation ─────────────────────────────────────────────────────────

export class LogStreamer {
    private readonly client: DockerClient;

    constructor(client: DockerClient) {
        this.client = client;
    }

    /**
     * Get historical logs from a container.
     *
     * @returns Array of log entries
     */
    async getLogs(idOrName: string, options: LogOptions = {}): Promise<LogEntry[]> {
        await this.client.ensureAvailable();

        try {
            const container = this.client.getEngine().getContainer(idOrName);
            const stream = await container.logs({
                follow: false,
                stdout: options.stdout ?? true,
                stderr: options.stderr ?? true,
                tail: options.tail,
                since: options.since ? Math.floor(new Date(options.since).getTime() / 1000) : undefined,
                timestamps: true,
            });

            // Docker logs return a multiplexed stream buffer
            return this.parseLogBuffer(stream as unknown as Buffer);
        } catch (err) {
            this.throwLogError(idOrName, err);
        }
    }

    /**
     * Follow (tail) container logs in real time.
     *
     * @param callback - Called for each new log line
     * @returns A function to stop following
     */
    async follow(idOrName: string, callback: LogCallback, options: LogOptions = {}): Promise<() => void> {
        await this.client.ensureAvailable();

        try {
            const container = this.client.getEngine().getContainer(idOrName);
            const stream = await container.logs({
                follow: true,
                stdout: options.stdout ?? true,
                stderr: options.stderr ?? true,
                tail: options.tail ?? 50,
                timestamps: true,
            }) as unknown as Readable;

            let buffer = '';

            const onData = (chunk: Buffer): void => {
                buffer += chunk.toString('utf-8');
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    if (line.trim()) {
                        callback(this.parseLine(line));
                    }
                }
            };

            stream.on('data', onData);

            // Return cleanup function
            return () => {
                stream.removeListener('data', onData);
                stream.destroy();
            };
        } catch (err) {
            this.throwLogError(idOrName, err);
        }
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    private parseLogBuffer(buffer: Buffer): LogEntry[] {
        const entries: LogEntry[] = [];
        const text = buffer.toString('utf-8');
        const lines = text.split('\n');

        for (const line of lines) {
            if (line.trim()) {
                entries.push(this.parseLine(line));
            }
        }

        return entries;
    }

    private parseLine(line: string): LogEntry {
        // Docker log format with timestamps: "2024-01-01T00:00:00.000Z message"
        const tsMatch = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(.*)$/.exec(line);
        if (tsMatch) {
            return {
                stream: 'stdout',
                timestamp: tsMatch[1]!,
                line: tsMatch[2]!,
            };
        }

        return {
            stream: 'stdout',
            timestamp: new Date().toISOString(),
            line: line.replace(/^[\x00-\x08]/, ''), // Strip Docker multiplexing header bytes
        };
    }

    private throwLogError(idOrName: string, err: unknown): never {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('404') || message.includes('No such container')) {
            throw new OrchestratorError(
                ErrorCode.NOT_FOUND,
                `Container not found: "${idOrName}"`,
                { container: idOrName },
            );
        }
        throw new OrchestratorError(
            ErrorCode.CONTAINER_ERROR,
            `Failed to get logs for container "${idOrName}": ${message}`,
            { container: idOrName },
        );
    }
}
