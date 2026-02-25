import type { AIConfigStore } from './config/store.js';
import type { AgentOrchestrator } from './orchestrator.js';

export function registerCrudHandlers(
    handlers: Map<string, (payload: any, ctx: any) => any>,
    configStore: AIConfigStore,
    orchestrator: AgentOrchestrator
) {
    const BUILTIN_PREFIX = 'builtin:';

    const resolvePersistableToolIds = (rawToolIds: unknown): string[] => {
        const input = Array.isArray(rawToolIds) ? rawToolIds : [];
        const resolved: string[] = [];

        for (const rawId of input) {
            if (typeof rawId !== 'string' || rawId.trim() === '') continue;
            const toolId = rawId.trim();

            // Already a persisted config tool ID
            if (configStore.getTool(toolId as any)) {
                resolved.push(toolId);
                continue;
            }

            // Config tools may be sent by name from UI/clients
            const byConfigName = configStore.listTools().find((t) => t.name === toolId);
            if (byConfigName) {
                resolved.push(byConfigName.id);
                continue;
            }

            // Builtins can arrive as "builtin:<name>" or just "<name>"
            const builtinName = toolId.startsWith(BUILTIN_PREFIX)
                ? toolId.slice(BUILTIN_PREFIX.length)
                : toolId;

            const builtinDef = orchestrator.tools.get(builtinName);
            if (!builtinDef) {
                // Unknown tool reference: skip silently to avoid FK failures.
                continue;
            }

            let persisted = configStore.listTools().find((t) => t.name === builtinName);
            if (!persisted) {
                try {
                    persisted = configStore.createTool({
                        name: builtinName,
                        description:
                            builtinDef.description || `Builtin tool: ${builtinName}`,
                        parametersSchema:
                            (builtinDef.parameters as Record<string, unknown>) ||
                            { type: 'object', properties: {} },
                        handlerType: 'builtin',
                        handlerConfig: { name: builtinName },
                    });
                } catch {
                    // Likely a uniqueness race; resolve by re-reading.
                    persisted = configStore.listTools().find((t) => t.name === builtinName);
                }
            }

            if (persisted) {
                resolved.push(persisted.id);
            }
        }

        // Preserve order, remove duplicates
        return Array.from(new Set(resolved));
    };

    // ── Provider CRUD ─────────────────────────────────────────────
    handlers.set('provider.create', (p) => configStore.createProvider(p));
    handlers.set('provider.list', () => ({ providers: configStore.listProviders() }));
    handlers.set('provider.get', (p) => configStore.getProvider(p.id));
    handlers.set('provider.update', (p) => configStore.updateProvider(p.id, p));
    handlers.set('provider.delete', (p) => { configStore.deleteProvider(p.id); return { ok: true }; });

    // ── Model CRUD ────────────────────────────────────────────────
    handlers.set('model.create', (p) => configStore.createModel(p));
    handlers.set('model.list', () => ({ models: configStore.listModels() }));
    handlers.set('model.get', (p) => configStore.getModel(p.id));
    handlers.set('model.update', (p) => configStore.updateModel(p.id, p));
    handlers.set('model.delete', (p) => { configStore.deleteModel(p.id); return { ok: true }; });

    // ── Tool CRUD ─────────────────────────────────────────────────
    handlers.set('tool.create', (p) => configStore.createTool(p));
    handlers.set('tool.list', () => {
        const configTools = configStore.listTools().map(t => ({ ...t, source: 'config' as const }));
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
    handlers.set('tool.get', (p) => configStore.getTool(p.id));
    handlers.set('tool.update', (p) => configStore.updateTool(p.id, p));
    handlers.set('tool.delete', (p) => { configStore.deleteTool(p.id); return { ok: true }; });

    // ── MCP Server CRUD ───────────────────────────────────────────
    handlers.set('mcp.create', (p) => configStore.createMcpServer(p));
    handlers.set('mcp.list', () => ({ servers: configStore.listMcpServers() }));
    handlers.set('mcp.get', (p) => configStore.getMcpServer(p.id));
    handlers.set('mcp.update', (p) => configStore.updateMcpServer(p.id, p));
    handlers.set('mcp.delete', (p) => { configStore.deleteMcpServer(p.id); return { ok: true }; });

    // ── Agent Config CRUD ─────────────────────────────────────────
    handlers.set('config.create', (p) => {
        const toolIds = resolvePersistableToolIds(p.toolIds);
        return configStore.createAgent({ ...p, toolIds });
    });
    handlers.set('config.list', () => ({ agents: configStore.listAgents() }));
    handlers.set('config.get', (p) => configStore.getAgent(p.id));
    handlers.set('config.update', (p) => {
        const normalized = p.toolIds === undefined
            ? p
            : { ...p, toolIds: resolvePersistableToolIds(p.toolIds) };
        return configStore.updateAgent(p.id, normalized);
    });
    handlers.set('config.delete', (p) => { configStore.deleteAgent(p.id); return { ok: true }; });

    // ── Workflow Config CRUD ──────────────────────────────────────
    handlers.set('workflow.create', (p) => configStore.createWorkflow(p));
    handlers.set('workflow.list', () => ({ workflows: configStore.listWorkflows() }));
    handlers.set('workflow.get', (p) => configStore.getWorkflow(p.id));
    handlers.set('workflow.update', (p) => configStore.updateWorkflow(p.id, p));
    handlers.set('workflow.delete', (p) => { configStore.deleteWorkflow(p.id); return { ok: true }; });

    // ── Chat Session CRUD ─────────────────────────────────────────
    handlers.set('chat.create', (p) => {
        const toolIds = p.toolIds === undefined
            ? undefined
            : resolvePersistableToolIds(p.toolIds);
        return configStore.createChatSession({ ...p, toolIds });
    });
    handlers.set('chat.list', () => ({ sessions: configStore.listChatSessions() }));
    handlers.set('chat.get', (p) => configStore.getChatSession(p.id));
    handlers.set('chat.update', (p) => {
        const normalized = p.toolIds === undefined
            ? p
            : { ...p, toolIds: resolvePersistableToolIds(p.toolIds) };
        return configStore.updateChatSession(p.id, normalized);
    });
    handlers.set('chat.delete', (p) => { configStore.deleteChatSession(p.id); return { ok: true }; });
    handlers.set('chat.history', (p) => ({ messages: configStore.listChatMessages(p.sessionId) }));

    // ── Session ↔ Tool m2m ────────────────────────────────────────
    handlers.set('session.tools.set', (p) => {
        configStore.setSessionTools(p.sessionId, resolvePersistableToolIds(p.toolIds) as any);
        return { ok: true };
    });
    handlers.set('session.tools.get', (p) => ({
        tools: configStore.getSessionTools(p.sessionId),
    }));

    // ── Agent ↔ Tool m2m ──────────────────────────────────────────
    handlers.set('agent.tools.set', (p) => {
        configStore.setAgentTools(p.agentId, resolvePersistableToolIds(p.toolIds) as any);
        return { ok: true };
    });
    handlers.set('agent.tools.get', (p) => ({
        tools: configStore.getAgentTools(p.agentId),
    }));

    // ── Workflow Execution Read ───────────────────────────────────
    handlers.set('workflow.executions.list', (p) => ({
        executions: configStore.listWorkflowExecutions(p.workflowId),
    }));
    handlers.set('workflow.execution.get', (p) => configStore.getWorkflowExecution(p.id));
    handlers.set('workflow.execution.steps', (p) => ({
        steps: configStore.listWorkflowStepExecutions(p.executionId),
    }));

    // ── Memory CRUD ───────────────────────────────────────────────
    handlers.set('memory.add', (p) => orchestrator.memoryStore.add(p));
    handlers.set('memory.list', (p) => ({ memories: orchestrator.memoryStore.list(p.agentId) }));
    handlers.set('memory.search', (p) => ({ memories: orchestrator.memoryStore.search(p.query) }));
    handlers.set('memory.delete', (p) => { orchestrator.memoryStore.delete(p.id); return { ok: true }; });
}
