import { ErrorCode, OrchestratorError } from '@orch/shared';
import type { HandlerContext } from '@orch/daemon';
import type { AgentOrchestrator } from './orchestrator.js';
import type { AIConfigStore } from './config/store.js';

export function registerExecutionHandlers(
    handlers: Map<string, (payload: any, ctx: HandlerContext) => any>,
    orchestrator: AgentOrchestrator,
    configStore?: AIConfigStore
) {
    // ── Legacy compat ─────────────────────────────────────────────
    handlers.set('workflow', (p, ctx) => {
        if (!p.workspaceId || !p.prompt) {
            throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'workspaceId and prompt are required');
        }
        return orchestrator.runLegacyWorkflow(p, ctx.emit, ctx);
    });

    // ── Chat Send (streaming) ─────────────────────────────────────
    handlers.set('chat.send', (p, ctx) => {
        if (!configStore) throw new OrchestratorError(ErrorCode.SERVICE_UNAVAILABLE, 'AI config store not initialized');
        if (!p.sessionId || !p.content) {
            throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'sessionId and content are required');
        }
        const session = configStore.getChatSession(p.sessionId);
        if (!session) throw new OrchestratorError(ErrorCode.NOT_FOUND, 'Chat session not found');
        if (!session.agentId) throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'Chat session has no agent assigned');

        return orchestrator.runAgentChat(
            { agentId: session.agentId, sessionId: p.sessionId, prompt: p.content },
            ctx.emit, ctx,
        );
    });

    // ── Execution Actions ─────────────────────────────────────────
    handlers.set('chat.completions', (p, ctx) => {
        if (!p.prompt || (!p.model && !p.modelId)) {
            throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'prompt and either model or modelId are required');
        }
        return orchestrator.runChatCompletion(p, ctx.emit);
    });

    handlers.set('run.chat', (p, ctx) => {
        if (!p.agentId || !p.sessionId || !p.prompt) {
            throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'agentId, sessionId, and prompt are required');
        }
        return orchestrator.runAgentChat(p, ctx.emit, ctx);
    });

    handlers.set('run.workflow', (p, ctx) => {
        if (!p.workflowId || !p.input) {
            throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'workflowId and input are required');
        }
        return orchestrator.runWorkflow(p.workflowId, p.input, ctx.emit, ctx);
    });

    // ── Sync Actions ──────────────────────────────────────────────
    handlers.set('sync.ollama', async (p) => {
        return await orchestrator.ollamaSync.sync(p.baseUrl);
    });

    handlers.set('sync.ollama.check', async (p) => {
        const available = await orchestrator.ollamaSync.isAvailable(p.baseUrl);
        return { available };
    });
}
