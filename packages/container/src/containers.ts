/**
 * Container lifecycle management via Docker Engine API.
 *
 * Create, start, stop, restart, remove containers.
 */


import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { DockerClient } from './docker.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ContainerCreateOptions {
    /** Container name. */
    name: string;
    /** Image reference (must already be pulled). */
    image: string;
    /** Command to run. */
    cmd?: string[];
    /** Environment variables as KEY=VALUE strings. */
    env?: string[];
    /** Port mappings. */
    ports?: PortMapping[];
    /** Working directory inside the container. */
    workingDir?: string;
    /** CPU limit (e.g. 1.5 = 1.5 cores). */
    cpuLimit?: number;
    /** Memory limit in bytes. */
    memoryLimit?: number;
    /** Restart policy. */
    restartPolicy?: 'no' | 'always' | 'on-failure' | 'unless-stopped';
    /** Volume mounts. */
    volumes?: VolumeMount[];
    /** Labels for the container. */
    labels?: Record<string, string>;
    /** Auto-remove after exit. */
    autoRemove?: boolean;
}

export interface PortMapping {
    host: number;
    container: number;
    protocol?: 'tcp' | 'udp';
}

export interface VolumeMount {
    host: string;
    container: string;
    readOnly?: boolean;
}

export interface ContainerInfo {
    id: string;
    name: string;
    image: string;
    state: string;
    status: string;
    created: string;
    ports: PortMapping[];
    labels: Record<string, string>;
}

export interface ContainerInspectResult extends ContainerInfo {
    pid: number;
    exitCode: number | null;
    startedAt: string;
    finishedAt: string;
    restartCount: number;
    env: string[];
}

// ─── Implementation ─────────────────────────────────────────────────────────

export class ContainerManager {
    private readonly client: DockerClient;

    constructor(client: DockerClient) {
        this.client = client;
    }

    /**
     * Create a new container (does not start it).
     */
    async create(options: ContainerCreateOptions): Promise<ContainerInfo> {
        await this.client.ensureAvailable();

        try {
            const exposedPorts: Record<string, object> = {};
            const portBindings: Record<string, Array<{ HostPort: string }>> = {};

            for (const p of options.ports ?? []) {
                const proto = p.protocol ?? 'tcp';
                const key = `${p.container}/${proto}`;
                exposedPorts[key] = {};
                portBindings[key] = [{ HostPort: String(p.host) }];
            }

            const binds = (options.volumes ?? []).map(
                (v) => `${v.host}:${v.container}${v.readOnly ? ':ro' : ''}`,
            );

            const container = await this.client.getEngine().createContainer({
                name: options.name,
                Image: options.image,
                Cmd: options.cmd,
                Env: options.env,
                WorkingDir: options.workingDir,
                ExposedPorts: Object.keys(exposedPorts).length > 0 ? exposedPorts : undefined,
                Labels: {
                    'orchestrator.managed': 'true',
                    ...options.labels,
                },
                HostConfig: {
                    PortBindings: Object.keys(portBindings).length > 0 ? portBindings : undefined,
                    Binds: binds.length > 0 ? binds : undefined,
                    NanoCpus: options.cpuLimit ? Math.round(options.cpuLimit * 1e9) : undefined,
                    Memory: options.memoryLimit,
                    RestartPolicy: options.restartPolicy
                        ? { Name: options.restartPolicy, MaximumRetryCount: options.restartPolicy === 'on-failure' ? 3 : 0 }
                        : undefined,
                    AutoRemove: options.autoRemove,
                },
            });

            return this.inspect(container.id);
        } catch (err) {
            if (err instanceof OrchestratorError) throw err;
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('409') || message.includes('Conflict')) {
                throw new OrchestratorError(
                    ErrorCode.ALREADY_EXISTS,
                    `Container "${options.name}" already exists`,
                    { name: options.name },
                );
            }
            throw new OrchestratorError(
                ErrorCode.CONTAINER_ERROR,
                `Failed to create container "${options.name}": ${message}`,
                { name: options.name, image: options.image },
            );
        }
    }

    /**
     * Start a stopped container.
     */
    async start(idOrName: string): Promise<void> {
        await this.client.ensureAvailable();
        const container = this.client.getEngine().getContainer(idOrName);
        try {
            await container.start();
        } catch (err) {
            this.throwContainerError('start', idOrName, err);
        }
    }

    /**
     * Stop a running container.
     *
     * @param timeout - Seconds to wait before force-killing (default: 10)
     */
    async stop(idOrName: string, timeout = 10): Promise<void> {
        await this.client.ensureAvailable();
        const container = this.client.getEngine().getContainer(idOrName);
        try {
            await container.stop({ t: timeout });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // Not an error if already stopped
            if (message.includes('304') || message.includes('not running')) return;
            this.throwContainerError('stop', idOrName, err);
        }
    }

    /**
     * Restart a container.
     */
    async restart(idOrName: string, timeout = 10): Promise<void> {
        await this.client.ensureAvailable();
        const container = this.client.getEngine().getContainer(idOrName);
        try {
            await container.restart({ t: timeout });
        } catch (err) {
            this.throwContainerError('restart', idOrName, err);
        }
    }

    /**
     * Remove a container (force-removes if running).
     */
    async remove(idOrName: string, force = false): Promise<void> {
        await this.client.ensureAvailable();
        const container = this.client.getEngine().getContainer(idOrName);
        try {
            await container.remove({ force, v: true });
        } catch (err) {
            this.throwContainerError('remove', idOrName, err);
        }
    }

    /**
     * List containers.
     *
     * @param all - Include stopped containers (default: false)
     */
    async list(all = false): Promise<ContainerInfo[]> {
        await this.client.ensureAvailable();

        try {
            const containers = await this.client.getEngine().listContainers({
                all,
                filters: { label: ['orchestrator.managed=true'] },
            });

            return containers.map((c) => ({
                id: c.Id,
                name: (c.Names[0] ?? '').replace(/^\//, ''),
                image: c.Image,
                state: c.State,
                status: c.Status,
                created: new Date(c.Created * 1000).toISOString(),
                ports: (c.Ports ?? []).map((p) => ({
                    host: p.PublicPort ?? 0,
                    container: p.PrivatePort,
                    protocol: (p.Type ?? 'tcp') as 'tcp' | 'udp',
                })),
                labels: c.Labels ?? {},
            }));
        } catch (err) {
            throw new OrchestratorError(
                ErrorCode.CONTAINER_ERROR,
                `Failed to list containers: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    /**
     * Inspect a container by name or ID.
     */
    async inspect(idOrName: string): Promise<ContainerInspectResult> {
        await this.client.ensureAvailable();

        try {
            const container = this.client.getEngine().getContainer(idOrName);
            const info = await container.inspect();

            const ports: PortMapping[] = [];
            const portBindings = info.HostConfig?.PortBindings ?? {};
            for (const [key, bindings] of Object.entries(portBindings)) {
                const [port, proto] = key.split('/');
                for (const b of (bindings as Array<{ HostPort: string }>) ?? []) {
                    ports.push({
                        host: parseInt(b.HostPort, 10),
                        container: parseInt(port ?? '0', 10),
                        protocol: (proto ?? 'tcp') as 'tcp' | 'udp',
                    });
                }
            }

            return {
                id: info.Id,
                name: info.Name.replace(/^\//, ''),
                image: info.Config.Image,
                state: info.State.Status,
                status: `${info.State.Status} (${info.State.Running ? 'running' : 'stopped'})`,
                created: info.Created,
                ports,
                labels: info.Config.Labels ?? {},
                pid: info.State.Pid,
                exitCode: info.State.ExitCode ?? null,
                startedAt: info.State.StartedAt,
                finishedAt: info.State.FinishedAt,
                restartCount: info.RestartCount,
                env: info.Config.Env ?? [],
            };
        } catch (err) {
            this.throwContainerError('inspect', idOrName, err);
        }
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    private throwContainerError(action: string, idOrName: string, err: unknown): never {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('404') || message.includes('No such container')) {
            throw new OrchestratorError(
                ErrorCode.NOT_FOUND,
                `Container not found: "${idOrName}"`,
                { container: idOrName },
            );
        }
        throw new OrchestratorError(
            ErrorCode.CONTAINER_ERROR,
            `Failed to ${action} container "${idOrName}": ${message}`,
            { container: idOrName },
        );
    }
}
