/**
 * v2 CRUD Handlers — routes config CRUD actions to v2 repos directly.
 */
import type { AgentOrchestratorV2, OrchestratorRepos } from './orchestrator.js';
import type {
	ProviderId, ModelId, ToolConfigId, AgentConfigId,
	WorkflowId, SessionId, McpServerId,
} from './types.js';

const OLLAMA_TIMEOUT_MS = 5000;

export function registerCrudHandlersV2(
	handlers: Map<string, (payload: any, ctx: any) => any>,
	repos: OrchestratorRepos,
	orchestrator: AgentOrchestratorV2,
) {
	const BUILTIN_PREFIX = 'builtin:';

	const resolvePersistableToolIds = (rawToolIds: unknown): string[] => {
		const input = Array.isArray(rawToolIds) ? rawToolIds : [];
		const resolved: string[] = [];

		for (const rawId of input) {
			if (typeof rawId !== 'string' || rawId.trim() === '') continue;
			const toolId = rawId.trim();

			if (repos.tool.get(toolId as ToolConfigId)) {
				resolved.push(toolId);
				continue;
			}

			const byConfigName = repos.tool.list().find((t) => t.name === toolId);
			if (byConfigName) {
				resolved.push(byConfigName.id);
				continue;
			}

			const builtinName = toolId.startsWith(BUILTIN_PREFIX)
				? toolId.slice(BUILTIN_PREFIX.length)
				: toolId;

			const builtinDef = orchestrator.tools.get(builtinName);
			if (!builtinDef) continue;

			let persisted = repos.tool.list().find((t) => t.name === builtinName);
			if (!persisted) {
				try {
					persisted = repos.tool.create({
						name: builtinName,
						description: builtinDef.description || `Builtin tool: ${builtinName}`,
						parametersSchema: (builtinDef.parameters as Record<string, unknown>) || { type: 'object', properties: {} },
						handlerType: 'builtin',
						handlerConfig: { name: builtinName },
					});
				} catch {
					persisted = repos.tool.list().find((t) => t.name === builtinName);
				}
			}

			if (persisted) resolved.push(persisted.id);
		}

		return Array.from(new Set(resolved));
	};

	// ── Provider CRUD ─────────────────────────────────────────────
	handlers.set('provider.create', (p) => repos.provider.create(p));
	handlers.set('provider.list', () => ({ providers: repos.provider.list() }));
	handlers.set('provider.get', (p) => repos.provider.get(p.id as ProviderId));
	handlers.set('provider.update', (p) => repos.provider.update(p.id as ProviderId, p));
	handlers.set('provider.delete', (p) => { repos.provider.delete(p.id as ProviderId); return { ok: true }; });

	// ── Model CRUD ────────────────────────────────────────────────
	handlers.set('model.create', (p) => repos.model.create(p));
	handlers.set('model.list', () => ({ models: repos.model.list() }));
	handlers.set('model.get', (p) => repos.model.get(p.id as ModelId));
	handlers.set('model.update', (p) => repos.model.update(p.id as ModelId, p));
	handlers.set('model.delete', (p) => { repos.model.delete(p.id as ModelId); return { ok: true }; });

	// ── Tool CRUD ─────────────────────────────────────────────────
	handlers.set('tool.create', (p) => repos.tool.create(p));
	handlers.set('tool.list', () => {
		const configTools = repos.tool.list().map(t => ({ ...t, source: 'config' as const }));
		const builtinTools = orchestrator.tools.list().map(t => ({
			id: `builtin:${t.name}`,
			name: t.name,
			description: t.description,
			parametersSchema: t.parameters || {},
			handlerType: 'builtin' as const,
			handlerConfig: {},
			source: 'builtin' as const,
			createdAt: '',
			updatedAt: '',
		}));
		return { tools: [...builtinTools, ...configTools] };
	});
	handlers.set('tool.get', (p) => repos.tool.get(p.id as ToolConfigId));
	handlers.set('tool.update', (p) => repos.tool.update(p.id as ToolConfigId, p));
	handlers.set('tool.delete', (p) => { repos.tool.delete(p.id as ToolConfigId); return { ok: true }; });

	// ── MCP Server CRUD ───────────────────────────────────────────
	handlers.set('mcp.create', (p) => repos.mcpServer.create(p));
	handlers.set('mcp.list', () => ({ mcpServers: repos.mcpServer.list() }));
	handlers.set('mcp.get', (p) => repos.mcpServer.get(p.id as McpServerId));
	handlers.set('mcp.update', (p) => repos.mcpServer.update(p.id as McpServerId, p));
	handlers.set('mcp.delete', (p) => { repos.mcpServer.delete(p.id as McpServerId); return { ok: true }; });

	// ── Agent Config CRUD ─────────────────────────────────────────
	handlers.set('config.create', (p) => {
		const toolIds = resolvePersistableToolIds(p.toolIds);
		return repos.agent.create({ ...p, toolIds });
	});
	handlers.set('config.list', () => ({ agents: repos.agent.list() }));
	handlers.set('config.get', (p) => repos.agent.get(p.id as AgentConfigId));
	handlers.set('config.update', (p) => {
		const normalized = p.toolIds === undefined
			? p
			: { ...p, toolIds: resolvePersistableToolIds(p.toolIds) };
		return repos.agent.update(p.id as AgentConfigId, normalized);
	});
	handlers.set('config.delete', (p) => { repos.agent.delete(p.id as AgentConfigId); return { ok: true }; });

	// ── Workflow Config CRUD ──────────────────────────────────────
	handlers.set('workflow.create', (p) => repos.workflow.create(p));
	handlers.set('workflow.list', () => ({ workflows: repos.workflow.list() }));
	handlers.set('workflow.get', (p) => repos.workflow.get(p.id as WorkflowId));
	handlers.set('workflow.update', (p) => repos.workflow.update(p.id as WorkflowId, p));
	handlers.set('workflow.delete', (p) => { repos.workflow.delete(p.id as WorkflowId); return { ok: true }; });

	// ── Chat Session CRUD ─────────────────────────────────────────
	handlers.set('chat.create', (p) => {
		const toolIds = p.toolIds === undefined ? undefined : resolvePersistableToolIds(p.toolIds);
		return repos.session.create({ ...p, toolIds });
	});
	handlers.set('chat.list', () => ({ sessions: repos.session.list() }));
	handlers.set('chat.get', (p) => repos.session.get(p.id as SessionId));
	handlers.set('chat.update', (p) => {
		const normalized = p.toolIds === undefined
			? p
			: { ...p, toolIds: resolvePersistableToolIds(p.toolIds) };
		return repos.session.update(p.id as SessionId, normalized);
	});
	handlers.set('chat.delete', (p) => { repos.session.delete(p.id as SessionId); return { ok: true }; });
	handlers.set('chat.history', (p) => ({
		messages: repos.message.listBySession(p.sessionId as SessionId),
	}));

	// ── Session ↔ Tool m2m ────────────────────────────────────────
	handlers.set('session.tools.set', (p) => {
		repos.session.setTools(p.sessionId as SessionId, resolvePersistableToolIds(p.toolIds) as any);
		return { ok: true };
	});
	handlers.set('session.tools.get', (p) => ({
		tools: repos.session.getTools(p.sessionId as SessionId),
	}));

	// ── Agent ↔ Tool m2m ──────────────────────────────────────────
	handlers.set('agent.tools.set', (p) => {
		repos.agent.setTools(p.agentId as AgentConfigId, resolvePersistableToolIds(p.toolIds) as any);
		return { ok: true };
	});
	handlers.set('agent.tools.get', (p) => ({
		tools: repos.agent.getTools(p.agentId as AgentConfigId),
	}));

	// ── Execution Read ────────────────────────────────────────────
	handlers.set('workflow.executions.list', (p) => ({
		executions: repos.execution.listByWorkflow(p.workflowId as WorkflowId),
	}));
	handlers.set('workflow.execution.get', (p) => repos.execution.get(p.id));
	handlers.set('workflow.execution.steps', (p) => ({
		steps: repos.stateNode.listByExecution(p.executionId),
	}));

	// ── Memory CRUD ───────────────────────────────────────────────
	handlers.set('memory.add', (p) => repos.memory.create(p));
	handlers.set('memory.list', (p) => ({ memories: repos.memory.list(p.agentId) }));
	handlers.set('memory.search', (p) => ({ memories: repos.memory.search(p.query) }));
	handlers.set('memory.delete', (p) => { repos.memory.delete(p.id); return { ok: true }; });

	// ── Ollama Sync ────────────────────────────────────────────────
	handlers.set('sync.ollama.check', async (p) => {
		const baseUrl = (p.baseUrl as string | undefined) || 'http://localhost:11434';
		try {
			const res = await fetch(`${baseUrl}/api/tags`, {
				signal: AbortSignal.timeout(3000),
			});
			return { available: res.ok };
		} catch {
			return { available: false };
		}
	});

	handlers.set('sync.ollama', async (p) => {
		const baseUrl = (p.baseUrl as string | undefined) || 'http://localhost:11434';
		try {
			const res = await fetch(`${baseUrl}/api/tags`, {
				signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
			});
			if (!res.ok) {
				return { available: false, providerCreated: false, providerId: null, modelsAdded: [], modelsRemoved: [], modelsUnchanged: [], totalLocalModels: 0 };
			}

			const data = await res.json() as { models?: Array<{ model?: string; name?: string }> };
			const ollamaModelIds = (data.models ?? []).map(m => (m.model ?? m.name ?? '').trim()).filter(Boolean);

			// Find or create the Ollama provider
			let provider = repos.provider.list().find(prov => prov.type === 'ollama');
			let providerCreated = false;
			if (!provider) {
				provider = repos.provider.create({
					name: 'Ollama (Local)',
					type: 'ollama',
					baseUrl,
					authType: 'none',
				});
				providerCreated = true;
			}

			// Diff against existing models for this provider
			const existingModels = repos.model.list().filter(m => m.providerId === provider!.id);
			const existingByModelId = new Map(existingModels.map(m => [m.modelId, m]));
			const localSet = new Set(ollamaModelIds);

			const modelsAdded: string[] = [];
			const modelsRemoved: string[] = [];
			const modelsUnchanged: string[] = [];

			for (const modelId of ollamaModelIds) {
				if (existingByModelId.has(modelId)) {
					modelsUnchanged.push(modelId);
				} else {
					repos.model.create({
						name: modelId,
						providerId: provider!.id,
						modelId,
						params: { temperature: 0.7 },
					});
					modelsAdded.push(modelId);
				}
			}

			for (const [modelId, model] of existingByModelId) {
				if (!localSet.has(modelId)) {
					repos.model.delete(model.id as ModelId);
					modelsRemoved.push(modelId);
				}
			}

			return {
				available: true,
				providerCreated,
				providerId: provider!.id,
				modelsAdded,
				modelsRemoved,
				modelsUnchanged,
				totalLocalModels: ollamaModelIds.length,
			};
		} catch (e: any) {
			return {
				available: false, providerCreated: false, providerId: null,
				modelsAdded: [], modelsRemoved: [], modelsUnchanged: [],
				totalLocalModels: 0, error: e.message as string,
			};
		}
	});
}
