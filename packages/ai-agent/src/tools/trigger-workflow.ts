import type { HandlerContext } from '@orch/daemon';
import type { ToolDefinition } from '../tools.js';
import type { AgentOrchestrator } from '../orchestrator.js';
import type { WorkflowId } from '../config/types.js';

export function createTriggerWorkflowTool(orchestrator: AgentOrchestrator): ToolDefinition {
    return {
        name: 'trigger_workflow',
        description: 'Trigger an AI workflow by its ID with the given input.',
        parameters: {
            type: 'object',
            properties: {
                workflowId: {
                    type: 'string',
                    description: 'The ID of the workflow to trigger.'
                },
                input: {
                    type: 'string',
                    description: 'The input data or prompt to pass to the workflow.'
                }
            },
            required: ['workflowId', 'input']
        },
        execute: async (params: { workflowId: string, input: string }, _context?: HandlerContext) => {
            try {
                const result = await orchestrator.workflowRunner.run(
                    params.workflowId as WorkflowId,
                    params.input
                );
                
                return {
                    success: true,
                    workflowId: params.workflowId,
                    result
                };
            } catch (error: any) {
                return {
                    success: false,
                    error: error.message || 'Failed to trigger workflow'
                };
            }
        }
    };
}
