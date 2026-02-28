import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowRunner } from './workflow-runner.js';

describe('WorkflowRunner', () => {
    let store: any;
    let agentBuilder: any;
    let logger: any;

    beforeEach(() => {
        store = {
            getWorkflow: vi.fn(),
            createWorkflowExecution: vi.fn().mockReturnValue('exec-1'),
            updateWorkflowExecution: vi.fn(),
            createWorkflowStepExecution: vi.fn().mockImplementation(({ nodeId }: { nodeId: string }) => `step-${nodeId}`),
            updateWorkflowStepExecution: vi.fn(),
        };

        agentBuilder = {
            build: vi.fn(),
        };

        logger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
    });

    it('executes workflows that use legacy "workflowNode" with data.kind', async () => {
        store.getWorkflow.mockReturnValue({
            id: 'wf-1',
            name: 'Legacy Flow',
            type: 'sequential',
            nodes: [
                { id: 'n1', type: 'workflowNode', position: { x: 0, y: 0 }, data: { kind: 'input', label: 'Start' } },
                { id: 'n2', type: 'workflowNode', position: { x: 0, y: 100 }, data: { kind: 'output', label: 'End' } },
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n2' },
            ],
        });

        const runner = new WorkflowRunner(store, agentBuilder, logger);
        const result = await runner.run('wf-1' as any, 'hello world');

        expect(result.status).toBe('completed');
        expect(result.finalOutput).toBe('hello world');
        expect(store.createWorkflowStepExecution).toHaveBeenCalledWith({ executionId: 'exec-1', nodeId: 'n2' });
        expect(store.updateWorkflowExecution).toHaveBeenCalledWith('exec-1', {
            status: 'completed',
            finalOutput: 'hello world',
        });
    });

    it('fails with a clear error when input is not connected to output', async () => {
        store.getWorkflow.mockReturnValue({
            id: 'wf-2',
            name: 'Disconnected Flow',
            type: 'sequential',
            nodes: [
                { id: 'in', type: 'input', position: { x: 0, y: 0 }, data: {} },
                { id: 'out', type: 'output', position: { x: 0, y: 100 }, data: {} },
            ],
            edges: [],
        });

        const emitted: any[] = [];
        const runner = new WorkflowRunner(store, agentBuilder, logger);
        const result = await runner.run(
            'wf-2' as any,
            'hello',
            (_type, payload) => emitted.push(payload),
        );

        expect(result.status).toBe('failed');
        expect(result.finalOutput).toContain('Workflow has no executable path from input to output');
        expect(store.updateWorkflowExecution).toHaveBeenCalledWith('exec-1', {
            status: 'failed',
            finalOutput: 'Workflow has no executable path from input to output',
        });
        expect(emitted.some((e) => e?.type === 'workflow.error')).toBe(true);
    });
});
