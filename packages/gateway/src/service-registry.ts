/**
 * Redis-backed service registry for runtime service discovery.
 *
 * Services register themselves at startup via HSET service:registry.
 * The gateway reads the registry to validate that a target service
 * is alive before publishing events to its command channel.
 */

import type { Redis } from 'ioredis';
import { KEYS } from '@orch/event-contracts';
import type { ServiceRegistryEntry } from '@orch/event-contracts';

export class ServiceRegistry {
    constructor(private readonly redis: Redis) {}

    /**
     * Register a service (called at service startup).
     */
    async register(entry: ServiceRegistryEntry): Promise<void> {
        await this.redis.hset(
            KEYS.SERVICE_REGISTRY,
            entry.serviceName,
            JSON.stringify({
                lastHeartbeat: entry.lastHeartbeat,
                channels: entry.channels,
            }),
        );
    }

    /**
     * Update heartbeat timestamp (called periodically by each service).
     */
    async heartbeat(serviceName: string): Promise<void> {
        const raw = await this.redis.hget(KEYS.SERVICE_REGISTRY, serviceName);
        if (!raw) return;
        const data = JSON.parse(raw) as { lastHeartbeat: string; channels: string[] };
        data.lastHeartbeat = new Date().toISOString();
        await this.redis.hset(KEYS.SERVICE_REGISTRY, serviceName, JSON.stringify(data));
    }

    /**
     * List all registered services.
     */
    async list(): Promise<ServiceRegistryEntry[]> {
        const entries = await this.redis.hgetall(KEYS.SERVICE_REGISTRY);
        return Object.entries(entries).map(([name, value]) => {
            const data = JSON.parse(value as string) as { lastHeartbeat: string; channels: string[] };
            return { serviceName: name, ...data };
        });
    }

    /**
     * Remove a service from the registry (called on graceful shutdown).
     */
    async deregister(serviceName: string): Promise<void> {
        await this.redis.hdel(KEYS.SERVICE_REGISTRY, serviceName);
    }
}
