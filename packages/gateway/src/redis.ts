/**
 * Redis client factory.
 *
 * Creates separate ioredis connections for pub, sub, and general store
 * operations. Redis requires distinct connections for SUBSCRIBE mode.
 */

import { Redis } from 'ioredis';
import type { Redis as RedisInstance } from 'ioredis';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RedisConfig {
    host: string;
    port: number;
    password?: string;
    db?: number;
}

export interface RedisClients {
    /** Publishing commands and general operations. */
    pub: RedisInstance;
    /** Dedicated subscriber connection (enters SUBSCRIBE mode). */
    sub: RedisInstance;
    /** General data operations (HSET, HGET, etc.). */
    store: RedisInstance;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: RedisConfig = {
    host: '127.0.0.1',
    port: 6379,
};

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a single Redis client with sensible defaults.
 */
export function createRedisClient(config: Partial<RedisConfig> = {}): RedisInstance {
    const resolved = { ...DEFAULT_CONFIG, ...config };
    return new Redis({
        host: resolved.host,
        port: resolved.port,
        password: resolved.password,
        db: resolved.db,
        retryStrategy: (times: number) => Math.min(times * 50, 2000),
        lazyConnect: true,
    });
}

/**
 * Create the three-client Redis set required by the gateway.
 *
 * - `pub`   — PUBLISH commands and XADD audit entries
 * - `sub`   — SUBSCRIBE to per-session result channels
 * - `store` — HSET/HGET for sessions, service registry, and rate-limit state
 */
export function createRedisClients(config: Partial<RedisConfig> = {}): RedisClients {
    return {
        pub: createRedisClient(config),
        sub: createRedisClient(config),
        store: createRedisClient(config),
    };
}

/**
 * Gracefully close all Redis clients.
 */
export async function closeRedisClients(clients: RedisClients): Promise<void> {
    await Promise.all([
        clients.pub.quit(),
        clients.sub.quit(),
        clients.store.quit(),
    ]);
}
