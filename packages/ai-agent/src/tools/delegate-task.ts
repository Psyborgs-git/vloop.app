import type { HandlerContext } from '@orch/daemon';
import type { ToolDefinition } from '../tools.js';
import type { AgentOrchestrator } from '../orchestrator.js';
import type { AgentConfigId } from '../config/types.js';

export function createDelegateTaskTool(orchestrator: AgentOrchestrator): ToolDefinition {
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
        execute: async (params: { agentId: string, task: string }, _context?: HandlerContext) => {
            try {
                // Create a temporary session for the delegated task
                const session = await (orchestrator as any).configStore.createChat({
                    title: `Delegated Task: ${params.task.substring(0, 20)}...`,
                    mode: 'agent',
                    agentId: params.agentId
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
                    response: result.content
                };
            } catch (error: any) {
                return {
                    success: false,
                    error: error.message || 'Failed to delegate task'
                };
            }
        }
    };
}
