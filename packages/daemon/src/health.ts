/**
 * Health and readiness HTTP endpoints.
 *
 * Runs on a separate port (no TLS) for easy monitoring by systemd,
 * k8s probes, and external monitoring systems.
 */

import Fastify from 'fastify';
import type { Logger } from './logging.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SubsystemStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface SubsystemHealth {
    name: string;
    status: SubsystemStatus;
    message?: string;
}

export interface HealthServer {
    /** Start listening. */
    listen(): Promise<void>;
    /** Gracefully shutdown. */
    close(): Promise<void>;
    /** Register a subsystem health check. */
    registerSubsystem(name: string, check: () => SubsystemHealth): void;
    /** Mark the server as ready (all subsystems initialized). */
    markReady(): void;
}

// ─── Implementation ─────────────────────────────────────────────────────────

export function createHealthServer(
    port: number,
    bindAddress: string,
    logger: Logger,
): HealthServer {
    const app = Fastify({ logger: false });
    const subsystems = new Map<string, () => SubsystemHealth>();
    let isReady = false;

    // GET /healthz — always returns 200 with subsystem statuses
    app.get('/healthz', async (_req, reply) => {
        const statuses: SubsystemHealth[] = [];
        for (const [, check] of subsystems) {
            statuses.push(check());
        }

        const overall = statuses.every((s) => s.status === 'healthy')
            ? 'healthy'
            : statuses.some((s) => s.status === 'unhealthy')
                ? 'unhealthy'
                : 'degraded';

        return reply.status(200).send({
            status: overall,
            subsystems: statuses,
            timestamp: new Date().toISOString(),
        });
    });

    // GET /readyz — returns 200 only when all critical subsystems are ready
    app.get('/readyz', async (_req, reply) => {
        if (!isReady) {
            return reply.status(503).send({
                status: 'not_ready',
                message: 'Daemon is still initializing',
                timestamp: new Date().toISOString(),
            });
        }

        const statuses: SubsystemHealth[] = [];
        for (const [, check] of subsystems) {
            statuses.push(check());
        }

        const allHealthy = statuses.every((s) => s.status !== 'unhealthy');

        return reply.status(allHealthy ? 200 : 503).send({
            status: allHealthy ? 'ready' : 'not_ready',
            subsystems: statuses,
            timestamp: new Date().toISOString(),
        });
    });

    return {
        async listen() {
            await app.listen({ port, host: bindAddress });
            logger.info(
                { port, address: bindAddress },
                `Health server listening on http://${bindAddress}:${port}`,
            );
        },

        async close() {
            await app.close();
        },

        registerSubsystem(name: string, check: () => SubsystemHealth) {
            subsystems.set(name, check);
        },

        markReady() {
            isReady = true;
            logger.info('Daemon marked as ready');
        },
    };
}
