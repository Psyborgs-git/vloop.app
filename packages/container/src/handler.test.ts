import { describe, it, expect, vi } from 'vitest';
import { createContainerHandler } from './handler.js';
import { OrchestratorError, ErrorCode } from '@orch/shared';

describe('createContainerHandler', () => {
    it('returns unavailable=true for container.list when docker is unavailable', async () => {
        const imageManager: any = {};
        const containerManager: any = {
            list: vi.fn(async () => {
                throw new OrchestratorError(
                    ErrorCode.DOCKER_UNAVAILABLE,
                    'Docker Engine is not available',
                );
            }),
        };
        const logStreamer: any = {};

        const handler = createContainerHandler(imageManager, containerManager, logStreamer);
        const result = await handler('container.list', { all: true });

        expect(result).toEqual({
            containers: [],
            unavailable: true,
            message: 'Docker is unavailable. Container data is temporarily unavailable.',
        });
    });

    it('returns unavailable=true for socket hang up transient list failures', async () => {
        const imageManager: any = {};
        const containerManager: any = {
            list: vi.fn(async () => {
                throw new OrchestratorError(
                    ErrorCode.CONTAINER_ERROR,
                    'Failed to list containers: socket hang up',
                );
            }),
        };
        const logStreamer: any = {};

        const handler = createContainerHandler(imageManager, containerManager, logStreamer);
        const result = await handler('container.list', { all: false });

        expect(result).toEqual({
            containers: [],
            unavailable: true,
            message: 'Docker is unavailable. Container data is temporarily unavailable.',
        });
    });
});