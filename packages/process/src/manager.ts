/**
 * Process lifecycle manager.
 *
 * Tracks all spawned LRPs by ID. Start/stop/restart with health checking
 * and configurable restart policies.
 */

import { EventEmitter } from 'node:events';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import { ProcessSpawner } from './spawner.js';
import type { SpawnOptions, ProcessHandle, ProcessExitEvent } from './spawner.js';
import type { Logger } from '@orch/daemon';

// ─── Types ───────────────────────────────────────────────────────────────────

export type RestartPolicy = 'always' | 'on-failure' | 'never';

export type HealthCheckType = 'process' | 'tcp' | 'http';

export interface HealthCheck {
    type: HealthCheckType;
    /** For TCP/HTTP: target port. */
    port?: number;
    /** For HTTP: path to check (default: /). */
    path?: string;
    /** Check interval in ms (default: 10000). */
    intervalMs?: number;
    /** Timeout per check in ms (default: 5000). */
    timeoutMs?: number;
    /** Consecutive failures before unhealthy (default: 3). */
    failureThreshold?: number;
}

export interface ProcessDefinition extends SpawnOptions {
    /** Restart policy (default: 'never'). */
    restartPolicy?: RestartPolicy;
    /** Max restart attempts for 'on-failure' (default: 5). */
    maxRestarts?: number;
    /** Health check config. */
    healthCheck?: HealthCheck;
    /** Graceful shutdown timeout in ms before SIGKILL (default: 10000). */
    shutdownTimeoutMs?: number;
}

export type ProcessStatus = 'running' | 'stopped' | 'restarting' | 'failed' | 'unknown';

export interface ManagedProcess {
    id: string;
    command: string;
    args: string[];
    pid: number | null;
    status: ProcessStatus;
    startedAt: string | null;
    restartCount: number;
    lastExitCode: number | null;
    healthy: boolean;
    definition: ProcessDefinition;
}

// ─── Implementation ─────────────────────────────────────────────────────────

export class ProcessManager extends EventEmitter {
    private readonly spawner: ProcessSpawner;
    private readonly logger: Logger;
    private readonly processes = new Map<string, ManagedProcess>();
    private readonly handles = new Map<string, ProcessHandle>();
    private readonly healthTimers = new Map<string, ReturnType<typeof setInterval>>();
    private shuttingDown = false;

    constructor(logger: Logger) {
        super();
        this.spawner = new ProcessSpawner();
        this.logger = logger;

        // Listen for process exits
        this.spawner.on('exit', (event: ProcessExitEvent) => {
            this.handleExit(event);
        });
    }

    /**
     * Start a new managed process.
     */
    start(definition: ProcessDefinition): ManagedProcess {
        if (this.processes.has(definition.id)) {
            const existing = this.processes.get(definition.id)!;
            if (existing.status === 'running') {
                throw new OrchestratorError(
                    ErrorCode.ALREADY_EXISTS,
                    `Process "${definition.id}" is already running`,
                    { id: definition.id, pid: existing.pid },
                );
            }
        }

        const handle = this.spawner.spawn(definition);

        const managed: ManagedProcess = {
            id: definition.id,
            command: definition.command,
            args: definition.args ?? [],
            pid: handle.pid,
            status: 'running',
            startedAt: handle.startedAt,
            restartCount: this.processes.get(definition.id)?.restartCount ?? 0,
            lastExitCode: null,
            healthy: true,
            definition,
        };

        this.processes.set(definition.id, managed);
        this.handles.set(definition.id, handle);

        // Start health checking if configured
        if (definition.healthCheck) {
            this.startHealthCheck(definition.id, definition.healthCheck);
        }

        this.logger.info(
            { id: definition.id, pid: handle.pid, command: definition.command },
            `Process started: ${definition.id}`,
        );
        this.emit('started', managed);

        return managed;
    }

    /**
     * Stop a running process.
     *
     * Sends SIGTERM, then SIGKILL after shutdown timeout.
     */
    async stop(id: string): Promise<void> {
        const managed = this.requireProcess(id);
        const handle = this.handles.get(id);

        if (managed.status !== 'running' || !handle) {
            managed.status = 'stopped';
            this.stopHealthCheck(id);
            return;
        }

        this.stopHealthCheck(id);
        const timeout = managed.definition.shutdownTimeoutMs ?? 10000;

        // Send SIGTERM
        this.spawner.kill(handle, 'SIGTERM');
        managed.status = 'stopped';

        // Wait for graceful exit, then SIGKILL
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                if (this.spawner.isAlive(handle)) {
                    this.logger.warn({ id }, `Force killing process: ${id}`);
                    this.spawner.kill(handle, 'SIGKILL');
                }
                resolve();
            }, timeout);

            handle.process.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });
        });

        this.logger.info({ id }, `Process stopped: ${id}`);
        this.emit('stopped', managed);
    }

    /**
     * Restart a process.
     */
    async restart(id: string): Promise<ManagedProcess> {
        const managed = this.requireProcess(id);
        await this.stop(id);
        managed.restartCount++;
        return this.start(managed.definition);
    }

    /**
     * Get info about a managed process.
     */
    get(id: string): ManagedProcess {
        return this.requireProcess(id);
    }

    /**
     * List all managed processes.
     */
    list(): ManagedProcess[] {
        return Array.from(this.processes.values());
    }

    /**
     * Remove a process from management (must be stopped first).
     */
    remove(id: string): void {
        const managed = this.processes.get(id);
        if (!managed) return;

        if (managed.status === 'running') {
            throw new OrchestratorError(
                ErrorCode.PROCESS_ERROR,
                `Cannot remove running process "${id}". Stop it first.`,
                { id },
            );
        }

        this.stopHealthCheck(id);
        this.processes.delete(id);
        this.handles.delete(id);
    }

    /**
     * Gracefully shutdown all processes.
     * Sends SIGTERM to all, waits, then SIGKILL stragglers.
     */
    async shutdownAll(timeoutMs = 15000): Promise<void> {
        this.shuttingDown = true;

        const running = this.list().filter((p) => p.status === 'running');
        this.logger.info({ count: running.length }, 'Shutting down all processes');

        // Stop health checks
        for (const p of running) {
            this.stopHealthCheck(p.id);
        }

        // Send SIGTERM to all
        for (const p of running) {
            const handle = this.handles.get(p.id);
            if (handle) {
                this.spawner.kill(handle, 'SIGTERM');
            }
        }

        // Wait for all to exit or timeout
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                // Force kill stragglers
                for (const p of running) {
                    const handle = this.handles.get(p.id);
                    if (handle && this.spawner.isAlive(handle)) {
                        this.logger.warn({ id: p.id }, `Force killing straggler: ${p.id}`);
                        this.spawner.kill(handle, 'SIGKILL');
                    }
                }
                resolve();
            }, timeoutMs);

            // Check periodically
            const check = setInterval(() => {
                const allDead = running.every(
                    (p) => {
                        const h = this.handles.get(p.id);
                        return !h || !this.spawner.isAlive(h);
                    },
                );
                if (allDead) {
                    clearInterval(check);
                    clearTimeout(timer);
                    resolve();
                }
            }, 200);
        });

        this.logger.info('All processes shut down');
    }

    // ─── Internal ───────────────────────────────────────────────────────────

    private handleExit(event: ProcessExitEvent): void {
        const managed = this.processes.get(event.id);
        if (!managed) return;

        managed.lastExitCode = event.exitCode;
        managed.pid = null;
        this.stopHealthCheck(event.id);

        if (event.oomKilled) {
            this.logger.warn({ id: event.id }, `Process OOM killed: ${event.id}`);
            this.emit('oomKill', event);
        }

        // Handle restart policy
        if (this.shuttingDown) {
            managed.status = 'stopped';
            return;
        }

        const policy = managed.definition.restartPolicy ?? 'never';
        const maxRestarts = managed.definition.maxRestarts ?? 5;

        if (policy === 'always' || (policy === 'on-failure' && event.exitCode !== 0)) {
            if (managed.restartCount >= maxRestarts) {
                managed.status = 'failed';
                this.logger.error(
                    { id: event.id, restarts: managed.restartCount },
                    `Process "${event.id}" exceeded max restarts (${maxRestarts})`,
                );
                this.emit('failed', managed);
                return;
            }

            managed.status = 'restarting';
            managed.restartCount++;
            this.logger.info(
                { id: event.id, attempt: managed.restartCount, exitCode: event.exitCode },
                `Restarting process: ${event.id}`,
            );

            // Restart after a brief delay (avoid tight restart loops)
            setTimeout(() => {
                try {
                    const handle = this.spawner.spawn(managed.definition);
                    managed.pid = handle.pid;
                    managed.status = 'running';
                    managed.startedAt = handle.startedAt;
                    this.handles.set(event.id, handle);

                    if (managed.definition.healthCheck) {
                        this.startHealthCheck(event.id, managed.definition.healthCheck);
                    }

                    this.emit('restarted', managed);
                } catch (err) {
                    managed.status = 'failed';
                    this.logger.error({ id: event.id, err }, `Failed to restart: ${event.id}`);
                    this.emit('failed', managed);
                }
            }, 1000);
        } else {
            managed.status = 'stopped';
            this.emit('stopped', managed);
        }
    }

    private startHealthCheck(id: string, config: HealthCheck): void {
        const intervalMs = config.intervalMs ?? 10000;

        const timer = setInterval(async () => {
            const managed = this.processes.get(id);
            const handle = this.handles.get(id);
            if (!managed || !handle || managed.status !== 'running') return;

            let healthy = false;

            switch (config.type) {
                case 'process':
                    healthy = this.spawner.isAlive(handle);
                    break;
                case 'tcp': {
                    const port = config.port;
                    if (port) {
                        healthy = await this.checkTcp('127.0.0.1', port, config.timeoutMs ?? 5000);
                    }
                    break;
                }
                case 'http': {
                    const port = config.port;
                    const path = config.path ?? '/';
                    if (port) {
                        healthy = await this.checkHttp(port, path, config.timeoutMs ?? 5000);
                    }
                    break;
                }
            }

            managed.healthy = healthy;
        }, intervalMs);

        this.healthTimers.set(id, timer);
    }

    private stopHealthCheck(id: string): void {
        const timer = this.healthTimers.get(id);
        if (timer) {
            clearInterval(timer);
            this.healthTimers.delete(id);
        }
    }

    private async checkTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
        const { createConnection } = await import('node:net');
        return new Promise((resolve) => {
            const socket = createConnection({ host, port, timeout: timeoutMs });
            socket.on('connect', () => { socket.destroy(); resolve(true); });
            socket.on('error', () => { socket.destroy(); resolve(false); });
            socket.on('timeout', () => { socket.destroy(); resolve(false); });
        });
    }

    private async checkHttp(port: number, path: string, timeoutMs: number): Promise<boolean> {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: controller.signal });
            clearTimeout(timer);
            return res.ok;
        } catch {
            return false;
        }
    }

    private requireProcess(id: string): ManagedProcess {
        const managed = this.processes.get(id);
        if (!managed) {
            throw new OrchestratorError(
                ErrorCode.PROCESS_NOT_FOUND,
                `Process not found: "${id}"`,
                { id },
            );
        }
        return managed;
    }
}
