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

    it('evaluates code in a sandbox', async () => {
        const result = await sandbox.evaluate('1 + 1', { workspaceId: 'ws-1' });
        expect(result).toBe(2);
    });
});
