/**
 * Process log capture and streaming.
 *
 * Captures stdout/stderr from spawned processes, maintains a ring buffer
 * of recent lines, and provides a tail/stream API.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProcessLogEntry {
    processId: string;
    stream: 'stdout' | 'stderr';
    line: string;
    timestamp: string;
}

export type LogListener = (entry: ProcessLogEntry) => void;

// ─── Implementation ─────────────────────────────────────────────────────────

export class ProcessLogManager {
    private readonly buffers = new Map<string, ProcessLogEntry[]>();
    private readonly maxLinesPerProcess: number;
    private readonly listeners = new Set<LogListener>();

    constructor(maxLinesPerProcess = 1000) {
        this.maxLinesPerProcess = maxLinesPerProcess;
    }

    /**
     * Attach to a process's stdout/stderr and capture log lines.
     *
     * @param processId - The managed process ID
     * @param stdout - stdout stream (Readable)
     * @param stderr - stderr stream (Readable)
     * @returns Cleanup function to detach
     */
    attach(
        processId: string,
        stdout: NodeJS.ReadableStream | null,
        stderr: NodeJS.ReadableStream | null,
    ): () => void {
        if (!this.buffers.has(processId)) {
            this.buffers.set(processId, []);
        }

        let stdoutBuffer = '';
        let stderrBuffer = '';

        const handleData = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
            const isStdout = stream === 'stdout';
            const existingBuffer = isStdout ? stdoutBuffer : stderrBuffer;
            const text = existingBuffer + chunk.toString('utf-8');
            const lines = text.split('\n');
            const remaining = lines.pop() ?? '';

            if (isStdout) {
                stdoutBuffer = remaining;
            } else {
                stderrBuffer = remaining;
            }

            for (const line of lines) {
                if (line.trim()) {
                    this.addEntry(processId, stream, line);
                }
            }
        };

        const onStdout = (chunk: Buffer): void => handleData('stdout', chunk);
        const onStderr = (chunk: Buffer): void => handleData('stderr', chunk);

        stdout?.on('data', onStdout);
        stderr?.on('data', onStderr);

        // Return cleanup
        return () => {
            stdout?.removeListener('data', onStdout);
            stderr?.removeListener('data', onStderr);
        };
    }

    /**
     * Get recent log entries for a process.
     *
     * @param processId - Process ID
     * @param tail - Number of recent lines (default: all)
     */
    getLogs(processId: string, tail?: number): ProcessLogEntry[] {
        const buffer = this.buffers.get(processId) ?? [];
        if (tail && tail < buffer.length) {
            return buffer.slice(-tail);
        }
        return [...buffer];
    }

    /**
     * Subscribe to live log events (all processes).
     *
     * @returns Unsubscribe function
     */
    subscribe(listener: LogListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Clear logs for a process.
     */
    clear(processId: string): void {
        this.buffers.delete(processId);
    }

    /**
     * Clear all logs.
     */
    clearAll(): void {
        this.buffers.clear();
    }

    // ─── Internal ───────────────────────────────────────────────────────────

    private addEntry(processId: string, stream: 'stdout' | 'stderr', line: string): void {
        const entry: ProcessLogEntry = {
            processId,
            stream,
            line,
            timestamp: new Date().toISOString(),
        };

        const buffer = this.buffers.get(processId);
        if (buffer) {
            buffer.push(entry);
            // Trim ring buffer
            if (buffer.length > this.maxLinesPerProcess) {
                buffer.splice(0, buffer.length - this.maxLinesPerProcess);
            }
        }

        // Notify listeners
        for (const listener of this.listeners) {
            try {
                listener(entry);
            } catch {
                // Don't let listener errors break the log pipeline
            }
        }
    }
}
