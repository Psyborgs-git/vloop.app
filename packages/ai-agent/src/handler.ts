/**
 * Agent Handler — topic handler for all AI config CRUD + execution actions.
 *
 * Registered on the "agent" topic. Actions are namespaced:
 *   agent.provider.* | agent.model.* | agent.tool.* | agent.config.*
 *   agent.workflow.* | agent.chat.* | agent.memory.* | agent.run.*
 */

import { ErrorCode, OrchestratorError } from '@orch/shared';
import type { HandlerContext } from '@orch/daemon';
import type { AgentOrchestrator } from './orchestrator.js';
import type { AIConfigStore } from './config/store.js';
import { registerCrudHandlers } from './crud-handlers.js';
import { registerExecutionHandlers } from './execution-handlers.js';

export function createAgentHandler(orchestrator: AgentOrchestrator, configStore?: AIConfigStore) {
    const handlers = new Map<string, (payload: any, ctx: HandlerContext) => any>();

    if (configStore) {
        registerCrudHandlers(handlers, configStore, orchestrator);
    }
    registerExecutionHandlers(handlers, orchestrator, configStore);

    return async function agentHandler(rawAction: string, payload: unknown, ctx: HandlerContext) {
        const p = payload as Record<string, any>;

        // Normalize: strip topic prefix if the router passes "agent.tool.list" instead of "tool.list"
        const action = rawAction.startsWith('agent.') ? rawAction.slice(6) : rawAction;

        const handler = handlers.get(action);
        if (!handler) {
            throw new OrchestratorError(ErrorCode.UNKNOWN_ACTION, `Unknown agent action: ${action}`);
        }

        return handler(p, ctx);
    };
}

