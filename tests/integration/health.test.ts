/**
 * Integration test: Health & Readiness endpoints.
 *
 * Verifies /healthz and /readyz HTTP endpoints with subsystem registration.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createHealthServer } from '../../packages/daemon/src/health.js';
import { createLogger } from '../../packages/daemon/src/logging.js';

const logger = createLogger('error');

describe('Health Server', () => {
    let server: Awaited<ReturnType<typeof createHealthServer>> | null = null;
    const PORT = 19876; // Ephemeral port for testing

    afterEach(async () => {
        if (server) {
            await server.close();
            server = null;
        }
    });

    it('should return 503 on /readyz before markReady()', async () => {
        server = createHealthServer(PORT, '127.0.0.1', logger);
        await server.listen();

        const res = await fetch(`http://127.0.0.1:${PORT}/readyz`);
        expect(res.status).toBe(503);

        const body = await res.json();
        expect(body.status).toBe('not_ready');
    });

    it('should return 200 on /readyz after markReady()', async () => {
        server = createHealthServer(PORT, '127.0.0.1', logger);
        server.markReady();
        await server.listen();

        const res = await fetch(`http://127.0.0.1:${PORT}/readyz`);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.status).toBe('ready');
    });

    it('should return 200 on /healthz with subsystem statuses', async () => {
        server = createHealthServer(PORT, '127.0.0.1', logger);
        server.registerSubsystem('database', () => ({
            name: 'database',
            status: 'healthy',
            message: 'connected',
        }));
        server.registerSubsystem('vault', () => ({
            name: 'vault',
            status: 'healthy',
        }));
        await server.listen();

        const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.status).toBe('healthy');
        expect(body.subsystems).toHaveLength(2);
        expect(body.subsystems.map((s: { name: string }) => s.name).sort()).toEqual([
            'database',
            'vault',
        ]);
    });

    it('should report degraded when a subsystem is degraded', async () => {
        server = createHealthServer(PORT, '127.0.0.1', logger);
        server.registerSubsystem('cache', () => ({
            name: 'cache',
            status: 'degraded',
            message: 'high latency',
        }));
        server.registerSubsystem('db', () => ({
            name: 'db',
            status: 'healthy',
        }));
        await server.listen();

        const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
        const body = await res.json();
        expect(body.status).toBe('degraded');
    });

    it('should report unhealthy when a subsystem is unhealthy', async () => {
        server = createHealthServer(PORT, '127.0.0.1', logger);
        server.registerSubsystem('db', () => ({
            name: 'db',
            status: 'unhealthy',
            message: 'connection refused',
        }));
        await server.listen();

        const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
        const body = await res.json();
        expect(body.status).toBe('unhealthy');
    });

    it('should return 503 on /readyz when subsystem is unhealthy', async () => {
        server = createHealthServer(PORT, '127.0.0.1', logger);
        server.registerSubsystem('db', () => ({
            name: 'db',
            status: 'unhealthy',
        }));
        server.markReady();
        await server.listen();

        const res = await fetch(`http://127.0.0.1:${PORT}/readyz`);
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.status).toBe('not_ready');
    });
});
