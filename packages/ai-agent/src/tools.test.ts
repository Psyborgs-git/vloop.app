import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolRegistry } from './tools.js';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import { Logger } from '@orch/daemon';

describe('ToolRegistry', () => {
    let registry: ToolRegistry;
    let mockLogger: vi.Mocked<Logger>;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
        } as any;
        registry = new ToolRegistry(mockLogger as any);
    });

    it('registers and retrieves a tool', () => {
        const dummyTool = {
            name: 'get_weather',
            description: 'Get weather for location',
            parameters: { type: 'object' }
        };

        registry.register(dummyTool);

        const retrieved = registry.get('get_weather');
        expect(retrieved).toEqual(dummyTool);

        expect(registry.list()).toHaveLength(1);
    });

    it('prevents registering duplicate tools', () => {
        const dummyTool = {
            name: 'get_weather',
            description: 'Get weather',
            parameters: {}
        };

        registry.register(dummyTool);

        expect(() => {
            registry.register(dummyTool);
        }).toThrowError(/Tool already exists/);
    });
});
