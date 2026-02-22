/**
 * OCI image management via Docker Engine API.
 *
 * Pull, list, inspect, and remove images.
 */


import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { DockerClient } from './docker.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ImageInfo {
    id: string;
    repoTags: string[];
    size: number;
    created: string;
}

export interface PullProgress {
    status: string;
    progress?: string;
    id?: string;
}

export type PullProgressCallback = (progress: PullProgress) => void;

// ─── Implementation ─────────────────────────────────────────────────────────

export class ImageManager {
    private readonly client: DockerClient;

    constructor(client: DockerClient) {
        this.client = client;
    }

    /**
     * Pull an image from a registry.
     *
     * @param image - Image reference (e.g. "nginx:latest", "ghcr.io/org/app:v1")
     * @param onProgress - Optional callback for pull progress events
     */
    async pull(image: string, onProgress?: PullProgressCallback): Promise<ImageInfo> {
        await this.client.ensureAvailable();

        try {
            const docker = this.client.getEngine();
            const stream = await docker.pull(image);

            // Follow the pull stream to completion
            await new Promise<void>((resolve, reject) => {
                docker.modem.followProgress(
                    stream,
                    (err: Error | null) => {
                        if (err) reject(err);
                        else resolve();
                    },
                    (event: PullProgress) => {
                        onProgress?.(event);
                    },
                );
            });

            return this.inspect(image);
        } catch (err) {
            if (err instanceof OrchestratorError) throw err;
            throw new OrchestratorError(
                ErrorCode.CONTAINER_ERROR,
                `Failed to pull image "${image}": ${err instanceof Error ? err.message : String(err)}`,
                { image },
            );
        }
    }

    /**
     * List all images on the host.
     */
    async list(): Promise<ImageInfo[]> {
        await this.client.ensureAvailable();

        try {
            const images = await this.client.getEngine().listImages();
            return images.map((img) => ({
                id: img.Id,
                repoTags: img.RepoTags ?? [],
                size: img.Size,
                created: new Date(img.Created * 1000).toISOString(),
            }));
        } catch (err) {
            throw new OrchestratorError(
                ErrorCode.CONTAINER_ERROR,
                `Failed to list images: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    /**
     * Inspect an image by name or ID.
     */
    async inspect(imageRef: string): Promise<ImageInfo> {
        await this.client.ensureAvailable();

        try {
            const image = this.client.getEngine().getImage(imageRef);
            const info = await image.inspect();
            return {
                id: info.Id,
                repoTags: info.RepoTags ?? [],
                size: info.Size,
                created: info.Created,
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('404') || message.includes('No such image')) {
                throw new OrchestratorError(
                    ErrorCode.NOT_FOUND,
                    `Image not found: "${imageRef}"`,
                    { image: imageRef },
                );
            }
            throw new OrchestratorError(
                ErrorCode.CONTAINER_ERROR,
                `Failed to inspect image "${imageRef}": ${message}`,
                { image: imageRef },
            );
        }
    }

    /**
     * Remove an image by name or ID.
     */
    async remove(imageRef: string, force = false): Promise<void> {
        await this.client.ensureAvailable();

        try {
            const image = this.client.getEngine().getImage(imageRef);
            await image.remove({ force });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('404') || message.includes('No such image')) {
                throw new OrchestratorError(
                    ErrorCode.NOT_FOUND,
                    `Image not found: "${imageRef}"`,
                    { image: imageRef },
                );
            }
            throw new OrchestratorError(
                ErrorCode.CONTAINER_ERROR,
                `Failed to remove image "${imageRef}": ${message}`,
                { image: imageRef },
            );
        }
    }
}
