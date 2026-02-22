import { ErrorCode, OrchestratorError } from '@orch/shared';
import type { HandlerContext } from '@orch/daemon';
import type { AgentOrchestrator } from './orchestrator.js';

export function createAgentHandler(orchestrator: AgentOrchestrator) {
    return async function agentHandler(action: string, payload: unknown, _ctx: HandlerContext) {
        switch (action) {
            case 'agent.workflow': {
                const req = payload as { workspaceId: string; prompt: string };
                if (!req.workspaceId || !req.prompt) {
                    throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'workspaceId and prompt are required');
                }

                const result = await orchestrator.runWorkflow(req, _ctx.emit);
                return result;
            }

            default:
                throw new OrchestratorError(ErrorCode.UNKNOWN_ACTION, `Unknown action: ${action}`);
        }
    };
}
