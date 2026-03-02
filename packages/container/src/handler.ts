/**
 * WebSocket topic handler for `container.*` actions.
 *
 * Maps incoming WebSocket requests to ImageManager and ContainerManager methods.
 */

import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { ImageManager } from './images.js';
import type { ContainerManager, ContainerCreateOptions } from './containers.js';
import type { LogStreamer } from './logs.js';

// ─── Handler Factory ────────────────────────────────────────────────────────

export function createContainerHandler(
    imageManager: ImageManager,
    containerManager: ContainerManager,
    logStreamer: LogStreamer,
) {
    return async (action: string, payload: unknown): Promise<unknown> => {
        const data = (payload ?? {}) as Record<string, unknown>;

        switch (action) {
            // ── Image actions ───────────────────────────────────────────
            case 'image.pull': {
                const image = requireString(data, 'image');
                const info = await imageManager.pull(image);
                return info;
            }

            case 'image.list': {
                return { images: await imageManager.list() };
            }

            case 'image.inspect': {
                const image = requireString(data, 'image');
                return await imageManager.inspect(image);
            }

            case 'image.remove': {
                const image = requireString(data, 'image');
                const force = data['force'] === true;
                await imageManager.remove(image, force);
                return { ok: true, image };
            }

            // ── Container actions ───────────────────────────────────────
            case 'container.create': {
                const options: ContainerCreateOptions = {
                    name: requireString(data, 'name'),
                    image: requireString(data, 'image'),
                    cmd: data['cmd'] as string[] | undefined,
                    env: data['env'] as string[] | undefined,
                    workingDir: data['workingDir'] as string | undefined,
                    cpuLimit: data['cpuLimit'] as number | undefined,
                    memoryLimit: data['memoryLimit'] as number | undefined,
                    restartPolicy: data['restartPolicy'] as ContainerCreateOptions['restartPolicy'],
                    labels: data['labels'] as Record<string, string> | undefined,
                    autoRemove: data['autoRemove'] as boolean | undefined,
                };

                // Parse port mappings
                if (Array.isArray(data['ports'])) {
                    options.ports = (data['ports'] as Array<Record<string, unknown>>).map((p) => ({
                        host: p['host'] as number,
                        container: p['container'] as number,
                        protocol: (p['protocol'] ?? 'tcp') as 'tcp' | 'udp',
                    }));
                }

                // Parse volume mounts
                if (Array.isArray(data['volumes'])) {
                    options.volumes = (data['volumes'] as Array<Record<string, unknown>>).map((v) => ({
                        host: v['host'] as string,
                        container: v['container'] as string,
                        readOnly: v['readOnly'] as boolean | undefined,
                    }));
                }

                return await containerManager.create(options);
            }

            case 'container.start': {
                const id = requireString(data, 'id');
                await containerManager.start(id);
                return { ok: true, id };
            }

            case 'container.stop': {
                const id = requireString(data, 'id');
                const timeout = (data['timeout'] as number) ?? 10;
                await containerManager.stop(id, timeout);
                return { ok: true, id };
            }

            case 'container.restart': {
                const id = requireString(data, 'id');
                const timeout = (data['timeout'] as number) ?? 10;
                await containerManager.restart(id, timeout);
                return { ok: true, id };
            }

            case 'container.remove': {
                const id = requireString(data, 'id');
                const force = data['force'] === true;
                await containerManager.remove(id, force);
                return { ok: true, id };
            }

            case 'container.list': {
                const all = data['all'] === true;
                try {
                    return { containers: await containerManager.list(all) };
                } catch (err) {
                    if (err instanceof OrchestratorError) {
                        const msg = err.message.toLowerCase();
                        const dockerUnavailable =
                            err.code === ErrorCode.DOCKER_UNAVAILABLE ||
                            (err.code === ErrorCode.CONTAINER_ERROR && (
                                msg.includes('socket hang up') ||
                                msg.includes('econnrefused') ||
                                msg.includes('enoent') ||
                                msg.includes('docker is not available')
                            ));

                        if (dockerUnavailable) {
                            return {
                                containers: [],
                                unavailable: true,
                                message: 'Docker is unavailable. Container data is temporarily unavailable.',
                            };
                        }
                    }
                    throw err;
                }
            }

            case 'container.inspect': {
                const id = requireString(data, 'id');
                return await containerManager.inspect(id);
            }

            case 'container.logs': {
                const id = requireString(data, 'id');
                const logs = await logStreamer.getLogs(id, {
                    tail: data['tail'] as number | undefined,
                    since: data['since'] as string | undefined,
                });
                return { logs };
            }

            default:
                throw new OrchestratorError(
                    ErrorCode.UNKNOWN_ACTION,
                    `Unknown container action: "${action}"`,
                    {
                        action, availableActions: [
                            'image.pull', 'image.list', 'image.inspect', 'image.remove',
                            'container.create', 'container.start', 'container.stop',
                            'container.restart', 'container.remove', 'container.list',
                            'container.inspect', 'container.logs',
                        ]
                    },
                );
        }
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requireString(data: Record<string, unknown>, field: string): string {
    const value = data[field];
    if (typeof value !== 'string' || value.length === 0) {
        throw new OrchestratorError(
            ErrorCode.VALIDATION_ERROR,
            `Missing required field: "${field}"`,
            { field },
        );
    }
    return value;
}
