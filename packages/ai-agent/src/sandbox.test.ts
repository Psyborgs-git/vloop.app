import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentSandbox } from './sandbox.js';
import { Logger } from '@orch/daemon';
import { OrchestratorError, ErrorCode } from '@orch/shared';

describe('AgentSandbox', () => {
    let sandbox: AgentSandbox;
    let mockLogger: vi.Mocked<Logger>;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
        } as any;

        sandbox = new AgentSandbox(mockLogger);
    });

    it('throws INTERNAL_ERROR because evaluate is not yet fully implemented', async () => {
        await expect(sandbox.evaluate('console.log("hi")', { workspaceId: 'ws-1' })).rejects.toThrowError(/Sandbox execution not yet implemented/);
    });
});
