/**
 * Redis-backed WebSocket session store.
 *
 * Each WebSocket connection has a Redis HSET at ws:sessions:{connectionId}
 * containing userId, roles, and connection timestamp.
 *
 * This makes the gateway stateless — any gateway instance can hydrate
 * session data for any connection, enabling horizontal scaling.
 */

import type { Redis } from 'ioredis';
import { wsSessionKey } from '@orch/event-contracts';
import type { SessionInfo } from '@orch/event-contracts';

export class SessionStore {
    constructor(private readonly redis: Redis) {}

    /**
     * Store session info when a client authenticates.
     */
    async set(connectionId: string, session: SessionInfo): Promise<void> {
        const key = wsSessionKey(connectionId);
        await this.redis.hset(key, {
            userId: session.userId,
            roles: JSON.stringify(session.roles),
            connectedAt: session.connectedAt,
        });
    }

    /**
     * Hydrate session info for an existing connection.
     * Returns null if the connection is unknown.
     */
    async get(connectionId: string): Promise<SessionInfo | null> {
        const key = wsSessionKey(connectionId);
        const data = await this.redis.hgetall(key);
        if (!data || !data['userId']) return null;
        return {
            userId: data['userId'],
            roles: JSON.parse(data['roles'] ?? '[]') as string[],
            connectedAt: data['connectedAt'] ?? '',
        };
    }

    /**
     * Remove session on disconnect.
     */
    async delete(connectionId: string): Promise<void> {
        await this.redis.del(wsSessionKey(connectionId));
    }
}
