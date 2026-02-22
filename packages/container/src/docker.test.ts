import { describe, it, expect, vi } from 'vitest';
import { DockerClient } from './docker.js';
import { ErrorCode } from '@orch/shared';

describe('DockerClient', () => {
    it('initializes and defaults to available=null until checked', () => {
        const client = new DockerClient({ socketPath: '/tmp/fake.sock' });
        expect(client.isAvailable()).toBe(null);
    });

    it('throws DOCKER_UNAVAILABLE when ping fails', async () => {
        const client = new DockerClient({ socketPath: '/tmp/nonexistent.sock' });

        await expect(client.ping()).resolves.toBe(false);
        expect(client.isAvailable()).toBe(false);

        await expect(client.ensureAvailable()).rejects.toThrowError(/Docker Engine is not available/);

        try {
            await client.ensureAvailable();
        } catch (err: any) {
            expect(err.code).toBe(ErrorCode.DOCKER_UNAVAILABLE);
        }
    });

    it('successfully pings and becomes available when socket is mocked', async () => {
        const client = new DockerClient({ socketPath: '/tmp/fake.sock' });

        // Mock dockerode ping internally via intercepting getEngine
        const engine = client.getEngine();
        engine.ping = vi.fn().mockResolvedValue('OK');
        engine.info = vi.fn().mockResolvedValue({ ServerVersion: '24.0.0' });

        const isUp = await client.ping();
        expect(isUp).toBe(true);
        expect(client.isAvailable()).toBe(true);

        const info = await client.checkAvailability();
        expect(info).toMatchObject({ serverVersion: '24.0.0' });
    });
});
