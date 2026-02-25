/**
 * Agent Client — typed namespace for all AI config + execution actions.
 *
 * Mirrors the handler actions in @orch/ai-agent/handler.
 */

import { OrchestratorClient } from '../client.js';

// ─── Minimal type aliases (avoid circular dep on @orch/ai-agent) ─────────────
// These mirror the shapes from config/types.ts without importing them.

interface ProviderConfig { id: string; name: string; type: string; adapter?: string; authType?: string; baseUrl?: string; apiKeyRef?: string; headers?: Record<string, string>; timeoutMs?: number; metadata?: Record<string, unknown>; createdAt: string; updatedAt: string; }
interface ModelConfig { id: string; name: string; providerId: string; modelId: string; runtime?: string; supportsTools?: boolean; supportsStreaming?: boolean; params: Record<string, unknown>; createdAt: string; updatedAt: string; }
interface ToolConfig { id: string; name: string; description: string; parametersSchema: Record<string, unknown>; handlerType: string; handlerConfig: Record<string, unknown>; createdAt: string; updatedAt: string; }
interface AgentConfig { id: string; name: string; description: string; modelId: string; systemPrompt: string; toolIds: string[]; mcpServerIds?: string[]; params?: Record<string, unknown>; createdAt: string; updatedAt: string; }
interface WorkflowConfig { id: string; name: string; description: string; type: string; nodes: unknown[]; edges: unknown[]; createdAt: string; updatedAt: string; }
interface ChatSession { id: string; agentId?: string; workflowId?: string; modelId?: string; providerId?: string; mode?: string; title: string; toolIds: string[]; mcpServerIds?: string[]; createdAt: string; updatedAt: string; }
interface ChatMessage { id: string; sessionId: string; role: string; content: string; providerType?: string; modelId?: string; toolCalls?: unknown[]; toolResults?: unknown[]; finishReason?: string; usage?: Record<string, unknown>; latencyMs?: number; metadata?: Record<string, unknown>; createdAt: string; }
interface MemoryEntry { id: string; sessionId?: string; agentId?: string; content: string; sourceType?: string; importance?: number; topic?: string; entities?: string[]; metadata?: Record<string, unknown>; createdAt: string; }
interface McpServerConfig { id: string; name: string; transport: string; url?: string; command?: string; args?: string[]; env?: Record<string, string>; createdAt: string; updatedAt: string; }

export class AgentClient {
    constructor(private readonly client: OrchestratorClient) { }

    // ── Legacy Compat ──────────────────────────────────────────────────

    public async runWorkflow(workspaceId: string, prompt: string, model?: string): Promise<any> {
        return this.client.request('agent', 'workflow', { workspaceId, prompt, model });
    }

    public invokeStream(workspaceId: string, prompt: string, model?: string): AsyncGenerator<any, any, undefined> {
        return this.client.requestStream<any, any>('agent', 'workflow', { workspaceId, prompt, model });
    }

    // ── Provider CRUD ──────────────────────────────────────────────────

    public createProvider(data: Omit<ProviderConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProviderConfig> {
        return this.client.request('agent', 'provider.create', data);
    }
    public listProviders(): Promise<{ providers: ProviderConfig[] }> {
        return this.client.request('agent', 'provider.list', {});
    }
    public getProvider(id: string): Promise<ProviderConfig> {
        return this.client.request('agent', 'provider.get', { id });
    }
    public updateProvider(id: string, data: Partial<Omit<ProviderConfig, 'id' | 'createdAt' | 'updatedAt'>>): Promise<ProviderConfig> {
        return this.client.request('agent', 'provider.update', { id, ...data });
    }
    public deleteProvider(id: string): Promise<{ ok: boolean }> {
        return this.client.request('agent', 'provider.delete', { id });
    }

    // ── Model CRUD ─────────────────────────────────────────────────────

    public createModel(data: Omit<ModelConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<ModelConfig> {
        return this.client.request('agent', 'model.create', data);
    }
    public listModels(): Promise<{ models: ModelConfig[] }> {
        return this.client.request('agent', 'model.list', {});
    }
    public getModel(id: string): Promise<ModelConfig> {
        return this.client.request('agent', 'model.get', { id });
    }
    public updateModel(id: string, data: Partial<Omit<ModelConfig, 'id' | 'createdAt' | 'updatedAt'>>): Promise<ModelConfig> {
        return this.client.request('agent', 'model.update', { id, ...data });
    }
    public deleteModel(id: string): Promise<{ ok: boolean }> {
        return this.client.request('agent', 'model.delete', { id });
    }

    // ── Tool CRUD ──────────────────────────────────────────────────────

    public createTool(data: Omit<ToolConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<ToolConfig> {
        return this.client.request('agent', 'tool.create', data);
    }
    public listTools(): Promise<{ tools: ToolConfig[] }> {
        return this.client.request('agent', 'tool.list', {});
    }
    public getTool(id: string): Promise<ToolConfig> {
        return this.client.request('agent', 'tool.get', { id });
    }
    public updateTool(id: string, data: Partial<Omit<ToolConfig, 'id' | 'createdAt' | 'updatedAt'>>): Promise<ToolConfig> {
        return this.client.request('agent', 'tool.update', { id, ...data });
    }
    public deleteTool(id: string): Promise<{ ok: boolean }> {
        return this.client.request('agent', 'tool.delete', { id });
    }

    // ── MCP Server CRUD ────────────────────────────────────────────────

    public createMcpServer(data: Omit<McpServerConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<McpServerConfig> {
        return this.client.request('agent', 'mcp.create', data);
    }
    public listMcpServers(): Promise<{ mcpServers: McpServerConfig[] }> {
        return this.client.request('agent', 'mcp.list', {});
    }
    public getMcpServer(id: string): Promise<McpServerConfig> {
        return this.client.request('agent', 'mcp.get', { id });
    }
    public updateMcpServer(id: string, data: Partial<Omit<McpServerConfig, 'id' | 'createdAt' | 'updatedAt'>>): Promise<McpServerConfig> {
        return this.client.request('agent', 'mcp.update', { id, ...data });
    }
    public deleteMcpServer(id: string): Promise<{ ok: boolean }> {
        return this.client.request('agent', 'mcp.delete', { id });
    }

    // ── Agent Config CRUD ──────────────────────────────────────────────

    public createAgent(data: Omit<AgentConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<AgentConfig> {
        return this.client.request('agent', 'config.create', data);
    }
    public listAgents(): Promise<{ agents: AgentConfig[] }> {
        return this.client.request('agent', 'config.list', {});
    }
    public getAgent(id: string): Promise<AgentConfig> {
        return this.client.request('agent', 'config.get', { id });
    }
    public updateAgent(id: string, data: Partial<Omit<AgentConfig, 'id' | 'createdAt' | 'updatedAt'>>): Promise<AgentConfig> {
        return this.client.request('agent', 'config.update', { id, ...data });
    }
    public deleteAgent(id: string): Promise<{ ok: boolean }> {
        return this.client.request('agent', 'config.delete', { id });
    }

    // ── Workflow CRUD ──────────────────────────────────────────────────

    public createWorkflowConfig(data: Omit<WorkflowConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<WorkflowConfig> {
        return this.client.request('agent', 'workflow.create', data);
    }
    public listWorkflowConfigs(): Promise<{ workflows: WorkflowConfig[] }> {
        return this.client.request('agent', 'workflow.list', {});
    }
    public getWorkflowConfig(id: string): Promise<WorkflowConfig> {
        return this.client.request('agent', 'workflow.get', { id });
    }
    public updateWorkflowConfig(id: string, data: Partial<Omit<WorkflowConfig, 'id' | 'createdAt' | 'updatedAt'>>): Promise<WorkflowConfig> {
        return this.client.request('agent', 'workflow.update', { id, ...data });
    }
    public deleteWorkflowConfig(id: string): Promise<{ ok: boolean }> {
        return this.client.request('agent', 'workflow.delete', { id });
    }

    // ── Chat Sessions ──────────────────────────────────────────────────

    public createChat(data?: { agentId?: string; workflowId?: string; modelId?: string; providerId?: string; mode?: 'chat' | 'agent' | 'workflow'; title?: string; toolIds?: string[] }): Promise<ChatSession> {
        return this.client.request('agent', 'chat.create', data ?? {});
    }
    public listChats(): Promise<{ sessions: ChatSession[] }> {
        return this.client.request('agent', 'chat.list', {});
    }
    public getChat(id: string): Promise<ChatSession> {
        return this.client.request('agent', 'chat.get', { id });
    }
    public updateChat(id: string, data: { title?: string; agentId?: string; workflowId?: string; modelId?: string; providerId?: string; mode?: 'chat' | 'agent' | 'workflow'; toolIds?: string[] }): Promise<ChatSession> {
        return this.client.request('agent', 'chat.update', { id, ...data });
    }
    public deleteChat(id: string): Promise<{ ok: boolean }> {
        return this.client.request('agent', 'chat.delete', { id });
    }
    public getChatHistory(sessionId: string): Promise<{ messages: ChatMessage[] }> {
        return this.client.request('agent', 'chat.history', { sessionId });
    }

    // ── Session ↔ Tool m2m ─────────────────────────────────────────────

    public setSessionTools(sessionId: string, toolIds: string[]): Promise<{ ok: boolean }> {
        return this.client.request('agent', 'session.tools.set', { sessionId, toolIds });
    }
    public getSessionTools(sessionId: string): Promise<{ tools: ToolConfig[] }> {
        return this.client.request('agent', 'session.tools.get', { sessionId });
    }

    // ── Agent ↔ Tool m2m ───────────────────────────────────────────────

    public setAgentTools(agentId: string, toolIds: string[]): Promise<{ ok: boolean }> {
        return this.client.request('agent', 'agent.tools.set', { agentId, toolIds });
    }
    public getAgentTools(agentId: string): Promise<{ tools: ToolConfig[] }> {
        return this.client.request('agent', 'agent.tools.get', { agentId });
    }

    /** Send a message to a chat session (streaming). */
    public sendMessage(sessionId: string, content: string): AsyncGenerator<any, any, undefined> {
        return this.client.requestStream<any, any>('agent', 'chat.send', { sessionId, content });
    }

    // ── Execution ──────────────────────────────────────────────────────

    /** Simple LLM chat completion (no tools / agent config). */
    public chatCompletion(payload: { model?: string; modelId?: string; prompt: string; systemPrompt?: string; sessionId?: string }): Promise<any> {
        return this.client.request('agent', 'chat.completions', payload);
    }

    /** Simple LLM chat completion with streaming. */
    public chatCompletionStream(payload: { model?: string; modelId?: string; prompt: string; systemPrompt?: string; sessionId?: string }): AsyncGenerator<any, any, undefined> {
        return this.client.requestStream<any, any>('agent', 'chat.completions', payload);
    }

    /** Run an agent chat with specific config (streaming). */
    public runAgentChat(agentId: string, sessionId: string, prompt: string): AsyncGenerator<any, any, undefined> {
        return this.client.requestStream<any, any>('agent', 'run.chat', { agentId, sessionId, prompt });
    }

    /** Run a workflow with initial input (streaming). */
    public runWorkflowExec(workflowId: string, input: string): AsyncGenerator<any, any, undefined> {
        return this.client.requestStream<any, any>('agent', 'run.workflow', { workflowId, input });
    }

    // ── Memory ─────────────────────────────────────────────────────────

    public createMemory(data: { content: string; agentId?: string; sessionId?: string; metadata?: Record<string, unknown> }): Promise<MemoryEntry> {
        return this.client.request('agent', 'memory.add', data);
    }
    public listMemories(agentId?: string): Promise<{ memories: MemoryEntry[] }> {
        return this.client.request('agent', 'memory.list', { agentId });
    }
    public searchMemories(query: string): Promise<{ memories: MemoryEntry[] }> {
        return this.client.request('agent', 'memory.search', { query });
    }
    public deleteMemory(id: string): Promise<{ ok: boolean }> {
        return this.client.request('agent', 'memory.delete', { id });
    }

    // ── Ollama Sync ────────────────────────────────────────────────────

    // ── Workflow Executions ────────────────────────────────────────────

    public listWorkflowExecutions(workflowId?: string): Promise<{ executions: any[] }> {
        return this.client.request('agent', 'workflow.executions.list', { workflowId });
    }
    public getWorkflowExecution(id: string): Promise<any> {
        return this.client.request('agent', 'workflow.execution.get', { id });
    }
    public listWorkflowStepExecutions(executionId: string): Promise<{ steps: any[] }> {
        return this.client.request('agent', 'workflow.execution.steps', { executionId });
    }

    /** Check if Ollama is available locally. */
    public checkOllama(baseUrl?: string): Promise<{ available: boolean }> {
        return this.client.request('agent', 'sync.ollama.check', { baseUrl });
    }

    /** Sync Ollama provider and models. */
    public syncOllama(baseUrl?: string): Promise<{
        available: boolean;
        providerCreated: boolean;
        providerId: string | null;
        modelsAdded: string[];
        modelsRemoved: string[];
        modelsUnchanged: string[];
        totalLocalModels: number;
        error?: string;
    }> {
        return this.client.request('agent', 'sync.ollama', { baseUrl });
    }
}
