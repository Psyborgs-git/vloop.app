import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { DockerClient } from './docker.js';
import { ErrorCode } from '@orch/shared';
import fs from 'node:fs';
import Dockerode from 'dockerode';

// Mock node:fs
vi.mock('node:fs', async () => {
    return {
        existsSync: vi.fn(),
        default: {
            existsSync: vi.fn(),
        }
    };
});

// Mock dockerode
vi.mock('dockerode', () => {
    return {
        default: vi.fn()
    };
});

describe('DockerClient', () => {
    const originalPlatform = process.platform;
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset process.env and process.platform defaults
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        process.env = { ...originalEnv };

        // Reset default mock implementation
        (Dockerode as unknown as Mock).mockImplementation(function() {
            return {
                info: vi.fn(),
                ping: vi.fn(),
            }
        });
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        process.env = originalEnv;
    });

    it('initializes and defaults to available=null until checked', () => {
        const client = new DockerClient({ socketPath: '/tmp/fake.sock' });
        expect(client.isAvailable()).toBe(null);
    });

    it('throws DOCKER_UNAVAILABLE when ping fails', async () => {
        const mockPing = vi.fn().mockRejectedValue(new Error('connect ENOENT /var/run/docker.sock'));

        (Dockerode as unknown as Mock).mockImplementation(function() {
             return {
                ping: mockPing,
                info: vi.fn(),
             }
        });

        const client = new DockerClient({ socketPath: '/tmp/nonexistent.sock' });

        await expect(client.ping()).resolves.toBe(false);
        expect(client.isAvailable()).toBe(false);
    });

    it('successfully pings and becomes available when socket is mocked', async () => {
        (Dockerode as unknown as Mock).mockImplementation(function() {
            return {
                ping: vi.fn().mockResolvedValue('OK'),
                info: vi.fn().mockResolvedValue({
                    ServerVersion: '24.0.0',
                    OperatingSystem: 'Linux',
                    Architecture: 'amd64',
                    Containers: 5,
                    Images: 10,
                }),
            };
        });

        const client = new DockerClient({ socketPath: '/tmp/fake.sock' });

        const isUp = await client.ping();
        expect(isUp).toBe(true);
        expect(client.isAvailable()).toBe(true);

        const info = await client.checkAvailability();
        expect(info).toMatchObject({ serverVersion: '24.0.0' });
    });

    // ─── Socket Path Detection Tests ───

    it('uses named pipe on Windows', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });

        new DockerClient();

        expect(Dockerode).toHaveBeenCalledWith(expect.objectContaining({
            socketPath: '//./pipe/docker_engine'
        }));
    });

    it('detects user-local socket in ~/.docker/run/docker.sock on Linux/macOS', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.env.HOME = '/home/user';

        const { existsSync } = await import('node:fs');

        (existsSync as Mock).mockImplementation((path) => {
            return path === '/home/user/.docker/run/docker.sock';
        });

        new DockerClient();

        expect(Dockerode).toHaveBeenCalledWith(expect.objectContaining({
            socketPath: '/home/user/.docker/run/docker.sock'
        }));
    });

    it('detects desktop socket in ~/.docker/desktop/docker.sock on Linux/macOS', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        process.env.HOME = '/Users/user';

        const { existsSync } = await import('node:fs');

        (existsSync as Mock).mockImplementation((path) => {
            return path === '/Users/user/.docker/desktop/docker.sock';
        });

        new DockerClient();

        expect(Dockerode).toHaveBeenCalledWith(expect.objectContaining({
            socketPath: '/Users/user/.docker/desktop/docker.sock'
        }));
    });

    it('falls back to /var/run/docker.sock if no user sockets exist', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.env.HOME = '/home/user';

        const { existsSync } = await import('node:fs');
        (existsSync as Mock).mockReturnValue(false);

        new DockerClient();

        expect(Dockerode).toHaveBeenCalledWith(expect.objectContaining({
            socketPath: '/var/run/docker.sock'
        }));
    });

    // ─── Availability & Error Hint Tests ───

    it('provides macOS-specific hint when Docker is unreachable on macOS', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });

        // Mock connection failure
        const mockInfo = vi.fn().mockRejectedValue(new Error('connect ENOENT /var/run/docker.sock'));

        (Dockerode as unknown as Mock).mockImplementation(function() {
            return {
                info: mockInfo,
                ping: vi.fn(),
            };
        });

        const client = new DockerClient();

        try {
            await client.checkAvailability();
            throw new Error('Should have thrown');
        } catch (err: any) {
            expect(err.code).toBe(ErrorCode.DOCKER_UNAVAILABLE);
            expect(err.details.hint).toContain('Start Docker Desktop or run: open -a Docker');
            expect(client.isAvailable()).toBe(false);
        }
    });

    it('provides Linux-specific hint when Docker is unreachable on Linux', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });

        const mockInfo = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED /var/run/docker.sock'));

        (Dockerode as unknown as Mock).mockImplementation(function() {
            return {
                info: mockInfo,
                ping: vi.fn(),
            };
        });

        const client = new DockerClient();

        try {
            await client.checkAvailability();
            throw new Error('Should have thrown');
        } catch (err: any) {
            expect(err.code).toBe(ErrorCode.DOCKER_UNAVAILABLE);
            expect(err.details.hint).toContain('sudo systemctl start docker');
            expect(client.isAvailable()).toBe(false);
        }
    });

    it('provides generic hint for other platforms/errors', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });

        const mockInfo = vi.fn().mockRejectedValue(new Error('connect ENOENT //./pipe/docker_engine'));

        (Dockerode as unknown as Mock).mockImplementation(function() {
            return {
                info: mockInfo,
                ping: vi.fn(),
            };
        });

        const client = new DockerClient();

        try {
            await client.checkAvailability();
            throw new Error('Should have thrown');
        } catch (err: any) {
            expect(err.code).toBe(ErrorCode.DOCKER_UNAVAILABLE);
            expect(err.details.hint).toBe('Start Docker Desktop');
            expect(client.isAvailable()).toBe(false);
        }
    });

    it('handles generic non-connection errors without hints', async () => {
        const mockInfo = vi.fn().mockRejectedValue(new Error('500 Internal Server Error'));

        (Dockerode as unknown as Mock).mockImplementation(function() {
            return {
                info: mockInfo,
                ping: vi.fn(),
            };
        });

        const client = new DockerClient();

        try {
            await client.checkAvailability();
            throw new Error('Should have thrown');
        } catch (err: any) {
            expect(err.code).toBe(ErrorCode.DOCKER_UNAVAILABLE);
            expect(err.message).toContain('Failed to connect to Docker Engine: 500 Internal Server Error');
            // Should not have the specific connection hints
            expect(err.details?.hint).toBeUndefined();
            expect(client.isAvailable()).toBe(false);
        }
    });
});
