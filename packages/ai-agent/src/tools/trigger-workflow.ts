import type { HandlerContext } from '@orch/daemon';
import type { ToolDefinition } from '../tools.js';
import type { AgentOrchestratorV2 } from '../v2/orchestrator.js';
import type { WorkflowId } from '../v2/types.js';

type TriggerWorkflowParams = { workflowId: string; input: string };
type TriggerWorkflowResult =
    | { success: true; workflowId: string; result: unknown }
    | { success: false; error: string };

export function createTriggerWorkflowTool(orchestrator: AgentOrchestratorV2): ToolDefinition<TriggerWorkflowParams, TriggerWorkflowResult> {
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
        execute: async (params: TriggerWorkflowParams, _context?: HandlerContext) => {
            try {
                const result = await orchestrator.runWorkflow(params.workflowId as WorkflowId, params.input);
                
                return {
                    success: true,
                    workflowId: params.workflowId,
                    result
                };
            } catch (error: unknown) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Failed to trigger workflow',
                };
            }
        }
    };
}
