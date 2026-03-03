/**
 * v2 Agent Handler — topic handler for all AI config CRUD + execution actions.
 *
 * Registered on the "agent" topic. All actions flow through v2 repos
 * and AgentOrchestratorV2.
 */
import { ErrorCode, OrchestratorError } from '@orch/shared';
import type { HandlerContext } from '@orch/daemon';
import type { AgentOrchestratorV2 } from './orchestrator.js';
import type { CanvasRepo } from './repos/canvas-repo.js';
import { registerCrudHandlersV2 } from './crud-handlers.js';
import { registerCanvasHandlersV2 } from './canvas-handlers.js';
import { registerExecutionHandlersV2 } from './execution-handlers.js';

export function createAgentHandlerV2(
	orchestrator: AgentOrchestratorV2,
	canvasRepo?: CanvasRepo,
) {
	const handlers = new Map<string, (payload: any, ctx: HandlerContext) => any>();

	registerCrudHandlersV2(handlers, orchestrator.repos, orchestrator);
	if (canvasRepo) {
		registerCanvasHandlersV2(handlers, canvasRepo);
	}
	registerExecutionHandlersV2(handlers, orchestrator);

	return async function agentHandler(rawAction: string, payload: unknown, ctx: HandlerContext) {
		const p = payload as Record<string, any>;
		const action = rawAction.startsWith('agent.') ? rawAction.slice(6) : rawAction;

		const handler = handlers.get(action);
		if (!handler) {
			throw new OrchestratorError(ErrorCode.UNKNOWN_ACTION, `Unknown agent action: ${action}`);
		}

		return handler(p, ctx);
	};
}
