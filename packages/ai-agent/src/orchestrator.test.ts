import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentOrchestrator } from './orchestrator.js';
import { ToolRegistry } from './tools.js';
import { AgentSandbox } from './sandbox.js';
import { Logger } from '@orch/daemon';

describe('AgentOrchestrator', () => {
    let orchestrator: AgentOrchestrator;
    let mockTools: ToolRegistry;
    let mockSandbox: AgentSandbox;
    let mockLogger: vi.Mocked<Logger>;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
        } as any;

        mockTools = new ToolRegistry(mockLogger);
        mockSandbox = new AgentSandbox(mockLogger);

        orchestrator = new AgentOrchestrator(mockTools, mockSandbox, mockLogger);
    });

    it('initializes core services', async () => {
        expect(orchestrator).toBeDefined();
        expect(orchestrator.tools).toBeDefined();
        expect(orchestrator.sandbox).toBeDefined();
    });
});
