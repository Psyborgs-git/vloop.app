import type { AIConfigStore } from './config/store.js';
import type { AgentOrchestrator } from './orchestrator.js';

export function registerCrudHandlers(
    handlers: Map<string, (payload: any, ctx: any) => any>,
    configStore: AIConfigStore,
    orchestrator: AgentOrchestrator
) {
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

    // ── Agent Config CRUD ─────────────────────────────────────────
    handlers.set('config.create', (p) => configStore.createAgent(p));
    handlers.set('config.list', () => ({ agents: configStore.listAgents() }));
    handlers.set('config.get', (p) => configStore.getAgent(p.id));
    handlers.set('config.update', (p) => configStore.updateAgent(p.id, p));
    handlers.set('config.delete', (p) => { configStore.deleteAgent(p.id); return { ok: true }; });

    // ── Workflow Config CRUD ──────────────────────────────────────
    handlers.set('workflow.create', (p) => configStore.createWorkflow(p));
    handlers.set('workflow.list', () => ({ workflows: configStore.listWorkflows() }));
    handlers.set('workflow.get', (p) => configStore.getWorkflow(p.id));
    handlers.set('workflow.update', (p) => configStore.updateWorkflow(p.id, p));
    handlers.set('workflow.delete', (p) => { configStore.deleteWorkflow(p.id); return { ok: true }; });

    // ── Chat Session CRUD ─────────────────────────────────────────
    handlers.set('chat.create', (p) => configStore.createChatSession(p));
    handlers.set('chat.list', () => ({ sessions: configStore.listChatSessions() }));
    handlers.set('chat.get', (p) => configStore.getChatSession(p.id));
    handlers.set('chat.update', (p) => configStore.updateChatSession(p.id, p));
    handlers.set('chat.delete', (p) => { configStore.deleteChatSession(p.id); return { ok: true }; });
    handlers.set('chat.history', (p) => ({ messages: configStore.listChatMessages(p.sessionId) }));

    // ── Memory CRUD ───────────────────────────────────────────────
    handlers.set('memory.add', (p) => orchestrator.memoryStore.add(p));
    handlers.set('memory.list', (p) => ({ memories: orchestrator.memoryStore.list(p.agentId) }));
    handlers.set('memory.search', (p) => ({ memories: orchestrator.memoryStore.search(p.query) }));
    handlers.set('memory.delete', (p) => { orchestrator.memoryStore.delete(p.id); return { ok: true }; });
}
