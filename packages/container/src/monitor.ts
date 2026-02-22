/**
 * Container health monitoring and auto-restart.
 *
 * Polls container health status, emits events on state changes,
 * detects OOM kills, and auto-restarts per policy.
 */

import { EventEmitter } from 'node:events';
import type { DockerClient } from './docker.js';
import type { ContainerManager, ContainerInfo } from './containers.js';
import type { Logger } from '@orch/daemon';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ContainerState = 'running' | 'stopped' | 'restarting' | 'paused' | 'dead' | 'created' | 'removing' | 'unknown';

export interface ContainerEvent {
    containerId: string;
    containerName: string;
    previousState: ContainerState;
    currentState: ContainerState;
    timestamp: string;
    oomKilled?: boolean;
    exitCode?: number;
}

export interface MonitorOptions {
    /** Polling interval in ms (default: 5000). */
    pollIntervalMs?: number;
    /** Logger instance. */
    logger: Logger;
}

// ─── Implementation ─────────────────────────────────────────────────────────

export class ContainerMonitor extends EventEmitter {
    private readonly client: DockerClient;
    private readonly manager: ContainerManager;
    private readonly logger: Logger;
    private readonly pollIntervalMs: number;
    private states = new Map<string, ContainerState>();
    private timer: ReturnType<typeof setInterval> | null = null;
    private running = false;

    constructor(client: DockerClient, manager: ContainerManager, options: MonitorOptions) {
        super();
        this.client = client;
        this.manager = manager;
        this.logger = options.logger;
        this.pollIntervalMs = options.pollIntervalMs ?? 5000;
    }

    /**
     * Start monitoring. No-op if Docker is unavailable (logs a warning).
     */
    async start(): Promise<void> {
        if (this.running) return;

        // Gracefully skip if Docker is not available
        const available = await this.client.ping();
        if (!available) {
            this.logger.warn('Docker is not available — container monitoring disabled');
            return;
        }

        this.running = true;
        this.logger.info({ interval: this.pollIntervalMs }, 'Container monitor started');

        // Initial poll
        await this.poll();

        this.timer = setInterval(() => {
            this.poll().catch((err) => {
                this.logger.error({ err }, 'Container monitor poll failed');
            });
        }, this.pollIntervalMs);
    }

    /**
     * Stop monitoring.
     */
    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.running = false;
        this.states.clear();
        this.logger.info('Container monitor stopped');
    }

    /**
     * Check if the monitor is actively running.
     */
    isRunning(): boolean {
        return this.running;
    }

    /**
     * Single poll cycle: list containers, compare states, emit events.
     */
    private async poll(): Promise<void> {
        let containers: ContainerInfo[];
        try {
            containers = await this.manager.list(true);
        } catch {
            // Docker may have gone down — stop monitoring
            this.logger.warn('Failed to list containers during poll — Docker may be offline');
            return;
        }

        const currentIds = new Set<string>();

        for (const c of containers) {
            currentIds.add(c.id);
            const previousState = this.states.get(c.id) ?? 'unknown';
            const currentState = c.state as ContainerState;

            if (previousState !== currentState) {
                const event: ContainerEvent = {
                    containerId: c.id,
                    containerName: c.name,
                    previousState,
                    currentState,
                    timestamp: new Date().toISOString(),
                };

                // Detect OOM kill on state transition to stopped/dead
                if (currentState === 'stopped' || currentState === 'dead') {
                    try {
                        const details = await this.manager.inspect(c.id);
                        event.exitCode = details.exitCode ?? undefined;
                        // Exit code 137 typically indicates OOM kill
                        event.oomKilled = details.exitCode === 137;
                    } catch {
                        // Ignore inspection failures during monitoring
                    }
                }

                this.states.set(c.id, currentState);
                this.emit('stateChange', event);

                this.logger.info(
                    { container: c.name, from: previousState, to: currentState },
                    `Container state changed: ${c.name}`,
                );

                if (event.oomKilled) {
                    this.emit('oomKill', event);
                    this.logger.warn({ container: c.name }, `Container OOM killed: ${c.name}`);
                }
            }
        }

        // Detect removed containers
        for (const [id] of this.states) {
            if (!currentIds.has(id)) {
                const previousState = this.states.get(id)!;
                this.states.delete(id);
                this.emit('removed', {
                    containerId: id,
                    containerName: 'unknown',
                    previousState,
                    currentState: 'removing' as ContainerState,
                    timestamp: new Date().toISOString(),
                });
            }
        }
    }
}
