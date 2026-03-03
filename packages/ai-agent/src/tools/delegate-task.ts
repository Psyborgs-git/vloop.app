import type { HandlerContext } from '@orch/daemon';
import type { ToolDefinition } from '../tools.js';
import type { AgentOrchestratorV2 } from '../v2/orchestrator.js';
import type { AgentConfigId } from '../v2/types.js';

type DelegateTaskParams = { agentId: string; task: string };
type DelegateTaskResult =
    | { success: true; agentId: string; response: unknown }
    | { success: false; error: string };

export function createDelegateTaskTool(orchestrator: AgentOrchestratorV2): ToolDefinition<DelegateTaskParams, DelegateTaskResult> {
    return {
        name: 'delegate_task',
        description: 'Delegate a specific task or prompt to another AI agent and get its response.',
        parameters: {
            type: 'object',
            properties: {
                agentId: {
                    type: 'string',
                    description: 'The ID of the agent to delegate the task to.'
                },
                task: {
                    type: 'string',
                    description: 'The task description or prompt to send to the agent.'
                }
            },
            required: ['agentId', 'task']
        },
        execute: async (params: DelegateTaskParams, _context?: HandlerContext) => {
            try {
                // Create a temporary session for the delegated task
                const session = orchestrator.repos.session.create({
                    title: `Delegated Task: ${params.task.substring(0, 20)}...`,
                    mode: 'agent',
                    agentId: params.agentId as AgentConfigId,
                });

                // Run the agent chat and collect the full response
                const result = await orchestrator.runAgentChat({
                    agentId: params.agentId as AgentConfigId,
                    sessionId: session.id,
                    prompt: params.task
                });
                
                return {
                    success: true,
                    agentId: params.agentId,
                    response: result.result
                };
            } catch (error: unknown) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Failed to delegate task',
                };
            }
        }
    };
}
