/**
 * v2 Execution Handlers — routes execution actions to AgentOrchestratorV2.
 * Validates with repos directly (no AIConfigStore).
 */
import { ErrorCode, OrchestratorError } from '@orch/shared';
import type { HandlerContext } from '@orch/daemon';
import type { AgentOrchestratorV2 } from './orchestrator.js';
import type { SessionId, WorkflowId } from './types.js';

export function registerExecutionHandlersV2(
	handlers: Map<string, (payload: any, ctx: HandlerContext) => any>,
	orchestrator: AgentOrchestratorV2,
) {
	// ── Legacy compat ─────────────────────────────────────────────
	handlers.set('workflow', () => {
		throw new OrchestratorError(
			ErrorCode.VALIDATION_ERROR,
			'Legacy workflow execution is no longer supported. Use run.workflow instead.',
		);
	});

	// ── Chat Send (streaming) ─────────────────────────────────────
	handlers.set('chat.send', (p, ctx) => {
		if (!p.sessionId || !p.content) {
			throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'sessionId and content are required');
		}
		const session = orchestrator.repos.session.get(p.sessionId as SessionId);
		if (!session) throw new OrchestratorError(ErrorCode.NOT_FOUND, 'Chat session not found');
		if (!session.agentId) throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'Chat session has no agent assigned');

		return orchestrator.runAgentChat(
			{ agentId: session.agentId, sessionId: p.sessionId, prompt: p.content },
			ctx.emit,
			ctx,
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

	handlers.set('chat.rerun', (p, ctx) => {
		if (!p.sessionId || !p.messageId) {
			throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'sessionId and messageId are required');
		}
		const session = orchestrator.repos.session.get(p.sessionId as SessionId);
		if (!session) throw new OrchestratorError(ErrorCode.NOT_FOUND, 'Chat session not found');

		return orchestrator.rerunChatFromMessage(
			{ sessionId: p.sessionId, messageId: p.messageId, toolIds: p.toolIds },
			ctx.emit, ctx,
		);
	});

	handlers.set('chat.fork', (p) => {
		if (!p.sessionId || !p.messageId) {
			throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'sessionId and messageId are required');
		}
		const session = orchestrator.repos.session.get(p.sessionId as SessionId);
		if (!session) throw new OrchestratorError(ErrorCode.NOT_FOUND, 'Chat session not found');

		return orchestrator.forkChatFromMessage({
			sessionId: p.sessionId,
			messageId: p.messageId,
			title: p.title,
		});
	});

	handlers.set('chat.compact', (p) => {
		if (!p.sessionId) {
			throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'sessionId is required');
		}
		const session = orchestrator.repos.session.get(p.sessionId as SessionId);
		if (!session) throw new OrchestratorError(ErrorCode.NOT_FOUND, 'Chat session not found');

		return orchestrator.compactChatContext({
			sessionId: p.sessionId,
			maxChars: p.maxChars,
			keepLastMessages: p.keepLastMessages,
		});
	});

	handlers.set('run.workflow', (p, ctx) => {
		if (!p.workflowId || !p.input) {
			throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'workflowId and input are required');
		}
		return orchestrator.runWorkflow(p.workflowId as WorkflowId, p.input, ctx.emit, ctx);
	});
}
