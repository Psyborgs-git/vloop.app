/**
 * Docker Engine client wrapper.
 *
 * Detects socket path per platform. Provides explicit availability checking
 * so all consumers get clear errors when Docker is not installed or not running.
 */

import { existsSync } from 'node:fs';
import Dockerode from 'dockerode';
import { OrchestratorError, ErrorCode } from '@orch/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DockerClientOptions {
    /** Override socket path. Auto-detected if omitted. */
    socketPath?: string;
    /** Connection timeout in ms (default: 5000). */
    timeout?: number;
}

export interface DockerInfo {
    serverVersion: string;
    os: string;
    arch: string;
    containers: number;
    images: number;
}

// ─── Docker Availability Detection ──────────────────────────────────────────



// ─── Client Implementation ─────────────────────────────────────────────────

export class DockerClient {
    private docker: Dockerode;
    private available: boolean | null = null;
    private readonly timeout: number;

    constructor(options: DockerClientOptions = {}) {
        const socketPath = options.socketPath ?? detectSocketPathSync();
        this.timeout = options.timeout ?? 5000;
        this.docker = new Dockerode({ socketPath, timeout: this.timeout });
    }

    /**
     * Check if Docker Engine is available and responsive.
     * Caches the result after first successful check.
     *
     * @returns DockerInfo if available
     * @throws OrchestratorError with DOCKER_UNAVAILABLE code if not
     */
    async checkAvailability(): Promise<DockerInfo> {
        try {
            const info = await this.docker.info();
            this.available = true;
            return {
                serverVersion: info.ServerVersion as string,
                os: info.OperatingSystem as string,
                arch: info.Architecture as string,
                containers: info.Containers as number,
                images: info.Images as number,
            };
        } catch (err) {
            this.available = false;
            const message = err instanceof Error ? err.message : String(err);

            if (message.includes('ENOENT') || message.includes('ECONNREFUSED') || message.includes('connect')) {
                throw new OrchestratorError(
                    ErrorCode.DOCKER_UNAVAILABLE,
                    'Docker Engine is not available. Ensure Docker is installed and the daemon is running.',
                    {
                        hint: process.platform === 'darwin'
                            ? 'Start Docker Desktop or run: open -a Docker'
                            : process.platform === 'linux'
                                ? 'Start Docker daemon: sudo systemctl start docker'
                                : 'Start Docker Desktop',
                        originalError: message,
                    },
                );
            }

            throw new OrchestratorError(
                ErrorCode.DOCKER_UNAVAILABLE,
                `Failed to connect to Docker Engine: ${message}`,
                { originalError: message },
            );
        }
    }

    /**
     * Assert Docker is available. Call this before any Docker operation.
     * Uses cached availability if previously checked.
     */
    async ensureAvailable(): Promise<void> {
        if (this.available === true) return;
        await this.checkAvailability();
    }

    /** Returns whether Docker was detected as available (null if not yet checked). */
    isAvailable(): boolean | null {
        return this.available;
    }

    /** Get the underlying Dockerode instance. */
    getEngine(): Dockerode {
        return this.docker;
    }

    /** Ping the Docker daemon. */
    async ping(): Promise<boolean> {
        try {
            await this.docker.ping();
            this.available = true;
            return true;
        } catch {
            this.available = false;
            return false;
        }
    }
}

/**
 * Synchronous socket path detection.
 * Checks multiple known Docker socket locations per platform.
 */
function detectSocketPathSync(): string {
    if (process.platform === 'win32') {
        return '//./pipe/docker_engine';
    }

    const home = process.env['HOME'] ?? '';
    const candidates = [
        `${home}/.docker/run/docker.sock`,
        `${home}/.docker/desktop/docker.sock`,
        '/var/run/docker.sock',
    ];

    for (const sock of candidates) {
        if (existsSync(sock)) return sock;
    }

    return '/var/run/docker.sock'; // last-resort default
}
