/**
 * ServiceWorker — base class for event-driven service adapters.
 *
 * Each service creates a concrete subclass that:
 *   1. Subscribes to its command channel (e.g. terminal:commands)
 *   2. Validates incoming events against Zod schemas
 *   3. Processes the command
 *   4. Publishes results to the per-session reply channel
 *   5. Registers itself in the service registry
 *   6. Sends heartbeats
 *
 * This is the only shared code between services besides event-contracts types.
 * Services MUST NOT import other service code.
 */

import { z } from 'zod';
import { ServiceCommandSchema } from './schemas.js';
import { KEYS } from './channels.js';
import type { ServiceCommand, ServiceResult, ServiceRegistryEntry } from './types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ServiceWorkerConfig {
    /** Service name (e.g. 'terminal', 'ai', 'fs', 'vault'). */
    serviceName: string;
    /** Redis channel to subscribe to. */
    commandChannel: string;
    /** All channels this service listens on (for registry). */
    channels?: string[];
    /** Heartbeat interval in ms. Default: 30000 (30s). */
    heartbeatInterval?: number;
}

/**
 * Minimal Redis interface — just the methods ServiceWorker needs.
 * This avoids coupling to ioredis directly in the contracts package.
 */
export interface RedisLike {
    subscribe(channel: string): Promise<unknown>;
    unsubscribe(channel: string): Promise<unknown>;
    publish(channel: string, message: string): Promise<number>;
    on(event: string, callback: (...args: unknown[]) => void): unknown;
    hset(key: string, field: string, value: string): Promise<unknown>;
    hdel(key: string, field: string): Promise<unknown>;
}

// ─── Base Class ─────────────────────────────────────────────────────────────

export abstract class ServiceWorker {
    protected config: ServiceWorkerConfig;
    private subscriber: RedisLike;
    private publisher: RedisLike;
    private store: RedisLike;
    private heartbeatTimer?: ReturnType<typeof setInterval>;
    private running = false;

    constructor(
        config: ServiceWorkerConfig,
        connections: {
            subscriber: RedisLike;
            publisher: RedisLike;
            store: RedisLike;
        },
    ) {
        this.config = config;
        this.subscriber = connections.subscriber;
        this.publisher = connections.publisher;
        this.store = connections.store;
    }

    /**
     * Subclasses implement this to handle incoming commands.
     * Return void — publish results yourself via this.publishResult().
     */
    protected abstract handleCommand(command: ServiceCommand): Promise<void>;

    /**
     * Start the service worker:
     *   1. Register in service:registry
     *   2. Subscribe to command channel
     *   3. Begin heartbeat loop
     */
    async start(): Promise<void> {
        if (this.running) return;
        this.running = true;

        // Register in service:registry
        await this.registerService();

        // Subscribe to command channel
        this.subscriber.on('message', (_channel: unknown, message: unknown) => {
            const channel = String(_channel);
            if (channel !== this.config.commandChannel) return;
            void this.onMessage(String(message));
        });
        await this.subscriber.subscribe(this.config.commandChannel);

        // Start heartbeat
        const interval = this.config.heartbeatInterval ?? 30_000;
        this.heartbeatTimer = setInterval(() => {
            void this.registerService();
        }, interval);
    }

    /**
     * Stop the service worker gracefully.
     */
    async stop(): Promise<void> {
        this.running = false;

        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }

        await this.subscriber.unsubscribe(this.config.commandChannel);
        await this.deregisterService();
    }

    /**
     * Publish a result to the command's replyTo channel.
     */
    protected async publishResult(
        replyTo: string,
        result: ServiceResult,
    ): Promise<void> {
        await this.publisher.publish(replyTo, JSON.stringify(result));
    }

    /**
     * Publish an error result to the command's replyTo channel.
     */
    protected async publishError(
        replyTo: string,
        traceId: string,
        message: string,
    ): Promise<void> {
        await this.publishResult(replyTo, {
            traceId,
            timestamp: new Date().toISOString(),
            status: 'error',
            payload: { error: message },
            done: true,
        });
    }

    // ── Internal ────────────────────────────────────────────────────────

    private async onMessage(raw: string): Promise<void> {
        let command: ServiceCommand;
        try {
            command = ServiceCommandSchema.parse(JSON.parse(raw));
        } catch (err) {
            // Schema validation failed — can't reply because we don't have replyTo
            console.error(
                `[${this.config.serviceName}] Invalid command:`,
                err instanceof z.ZodError ? err.issues : err,
            );
            return;
        }

        try {
            await this.handleCommand(command);
        } catch (err) {
            // Command handler failed — send error result
            const message = err instanceof Error ? err.message : String(err);
            await this.publishError(command.replyTo, command.traceId, message);
        }
    }

    private async registerService(): Promise<void> {
        const entry: ServiceRegistryEntry = {
            serviceName: this.config.serviceName,
            lastHeartbeat: new Date().toISOString(),
            channels: this.config.channels ?? [this.config.commandChannel],
        };
        await this.store.hset(
            KEYS.SERVICE_REGISTRY,
            this.config.serviceName,
            JSON.stringify(entry),
        );
    }

    private async deregisterService(): Promise<void> {
        await this.store.hdel(KEYS.SERVICE_REGISTRY, this.config.serviceName);
    }
}
