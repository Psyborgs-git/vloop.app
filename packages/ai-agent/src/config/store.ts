/**
 * AI Configuration Store — typed CRUD repository.
 *
 * All entities are persisted in the encrypted SQLite database.
 * JSON columns are transparently (de)serialized.
 */

import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';
import type { Logger } from '@orch/daemon';
import { AI_CONFIG_MIGRATION } from './migrations.js';
import {
    generateId,
    type ProviderId, type ModelId, type ToolConfigId, type AgentConfigId,
    type WorkflowId, type ChatSessionId, type ChatMessageId, type MemoryId,
    type ProviderConfig, type CreateProviderInput,
    type ModelConfig, type CreateModelInput,
    type ToolConfig, type CreateToolInput,
    type AgentConfig, type CreateAgentInput,
    type WorkflowConfig, type CreateWorkflowInput,
    type ChatSession, type CreateChatSessionInput,
    type ChatMessage, type CreateChatMessageInput,
    type MemoryEntry, type CreateMemoryInput,
} from './types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const toJSON = (v: unknown): string => JSON.stringify(v ?? {});
const fromJSON = <T>(v: string | null | undefined): T => (v ? JSON.parse(v) : {} as T);
const now = () => new Date().toISOString();

// ─── Store ───────────────────────────────────────────────────────────────────

export class AIConfigStore {
    constructor(
        private readonly db: BetterSqlite3.Database,
        private readonly logger: Logger,
    ) { }

    /** Run the idempotent migration. */
    migrate(): void {
        this.db.exec(AI_CONFIG_MIGRATION);
        this.ensureOptionalColumns();
        this.logger.info('AI config tables migrated');
    }

    private ensureOptionalColumns(): void {
        const hasColumn = (table: string, column: string): boolean => {
            const info = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
            return info.some(c => c.name === column);
        };
        const ensureColumn = (table: string, column: string, definition: string) => {
            if (!hasColumn(table, column)) {
                this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
            }
        };

        ensureColumn('ai_providers', 'adapter', 'TEXT');
        ensureColumn('ai_providers', 'auth_type', 'TEXT');
        ensureColumn('ai_providers', 'headers', "TEXT DEFAULT '{}' ");
        ensureColumn('ai_providers', 'timeout_ms', 'INTEGER');

        ensureColumn('ai_models', 'runtime', 'TEXT');
        ensureColumn('ai_models', 'supports_tools', 'INTEGER');
        ensureColumn('ai_models', 'supports_streaming', 'INTEGER');

        ensureColumn('ai_chat_sessions', 'model_id', 'TEXT');
        ensureColumn('ai_chat_sessions', 'provider_id', 'TEXT');
        ensureColumn('ai_chat_sessions', 'mode', 'TEXT');

        ensureColumn('ai_workflows', 'nodes', "TEXT DEFAULT '[]'");
        ensureColumn('ai_workflows', 'edges', "TEXT DEFAULT '[]'");

        ensureColumn('ai_chat_messages', 'provider_type', 'TEXT');
        ensureColumn('ai_chat_messages', 'model_id', 'TEXT');
        ensureColumn('ai_chat_messages', 'finish_reason', 'TEXT');
        ensureColumn('ai_chat_messages', 'usage', 'TEXT');
        ensureColumn('ai_chat_messages', 'latency_ms', 'INTEGER');
        ensureColumn('ai_chat_messages', 'metadata', 'TEXT');

        ensureColumn('ai_memories', 'source_type', 'TEXT');
        ensureColumn('ai_memories', 'importance', 'REAL');
        ensureColumn('ai_memories', 'topic', 'TEXT');
        ensureColumn('ai_memories', 'entities', 'TEXT');

        ensureColumn('ai_tool_calls', 'tool_config_id', 'TEXT');

        // Ensure m2m join tables exist (idempotent — also in AI_CONFIG_MIGRATION for new installs)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS ai_agent_tools (
                agent_id   TEXT NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
                tool_id    TEXT NOT NULL REFERENCES ai_tools(id) ON DELETE CASCADE,
                sort_order INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (agent_id, tool_id)
            );
            CREATE INDEX IF NOT EXISTS idx_agent_tools_agent ON ai_agent_tools(agent_id);
            CREATE TABLE IF NOT EXISTS ai_chat_session_tools (
                session_id TEXT NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
                tool_id    TEXT NOT NULL REFERENCES ai_tools(id) ON DELETE CASCADE,
                sort_order INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (session_id, tool_id)
            );
            CREATE INDEX IF NOT EXISTS idx_session_tools_session ON ai_chat_session_tools(session_id);
        `);

        // One-time migration: populate ai_agent_tools from legacy tool_ids JSON column
        this.migrateAgentToolsJson();
    }

    /**
     * Migrate legacy tool_ids JSON array from ai_agents into ai_agent_tools join table.
     * Runs once per boot, skips agents that already have join table entries.
     */
    private migrateAgentToolsJson(): void {
        const agents = this.db.prepare('SELECT id, tool_ids FROM ai_agents').all() as Array<{ id: string; tool_ids: string | null }>;
        const insert = this.db.prepare('INSERT OR IGNORE INTO ai_agent_tools (agent_id, tool_id, sort_order) VALUES (?, ?, ?)');
        const migrate = this.db.transaction((agentId: string, toolIds: string[]) => {
            for (let i = 0; i < toolIds.length; i++) {
                try { insert.run(agentId, toolIds[i], i); } catch (_) { /* tool may not exist */ }
            }
        });
        for (const agent of agents) {
            const existing = (this.db.prepare('SELECT COUNT(*) as cnt FROM ai_agent_tools WHERE agent_id = ?').get(agent.id) as { cnt: number }).cnt;
            if (existing === 0 && agent.tool_ids) {
                const ids: string[] = JSON.parse(agent.tool_ids) || [];
                if (ids.length > 0) migrate(agent.id, ids);
            }
        }
    }

    // ── Providers ────────────────────────────────────────────────────────

    createProvider(input: CreateProviderInput): ProviderConfig {
        const id = generateId() as ProviderId;
        const ts = now();
        this.db.prepare(`
            INSERT INTO ai_providers (id, name, type, adapter, auth_type, base_url, api_key_ref, headers, timeout_ms, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            input.name,
            input.type,
            input.adapter ?? null,
            input.authType ?? null,
            input.baseUrl ?? null,
            input.apiKeyRef ?? null,
            toJSON(input.headers),
            input.timeoutMs ?? null,
            toJSON(input.metadata),
            ts,
            ts,
        );
        return this.getProvider(id)!;
    }

    getProvider(id: ProviderId): ProviderConfig | undefined {
        const row = this.db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as any;
        return row ? this.mapProvider(row) : undefined;
    }

    listProviders(): ProviderConfig[] {
        return (this.db.prepare('SELECT * FROM ai_providers ORDER BY created_at DESC').all() as any[]).map(r => this.mapProvider(r));
    }

    updateProvider(id: ProviderId, input: Partial<CreateProviderInput>): ProviderConfig {
        const existing = this.getProvider(id);
        if (!existing) throw new Error(`Provider not found: ${id}`);
        this.db.prepare(`
            UPDATE ai_providers SET name=?, type=?, adapter=?, auth_type=?, base_url=?, api_key_ref=?, headers=?, timeout_ms=?, metadata=?, updated_at=? WHERE id=?
        `).run(
            input.name ?? existing.name,
            input.type ?? existing.type,
            input.adapter ?? existing.adapter ?? null,
            input.authType ?? existing.authType ?? null,
            input.baseUrl ?? existing.baseUrl ?? null,
            input.apiKeyRef ?? existing.apiKeyRef ?? null,
            toJSON(input.headers ?? existing.headers),
            input.timeoutMs ?? existing.timeoutMs ?? null,
            toJSON(input.metadata ?? existing.metadata),
            now(),
            id,
        );
        return this.getProvider(id)!;
    }

    deleteProvider(id: ProviderId): void {
        this.db.prepare('DELETE FROM ai_providers WHERE id = ?').run(id);
    }

    private mapProvider(row: any): ProviderConfig {
        return {
            id: row.id, name: row.name, type: row.type,
            adapter: row.adapter ?? undefined,
            authType: row.auth_type ?? undefined,
            baseUrl: row.base_url ?? undefined, apiKeyRef: row.api_key_ref ?? undefined,
            headers: fromJSON(row.headers),
            timeoutMs: row.timeout_ms ?? undefined,
            metadata: fromJSON(row.metadata), createdAt: row.created_at, updatedAt: row.updated_at,
        };
    }

    // ── Models ────────────────────────────────────────────────────────────

    createModel(input: CreateModelInput): ModelConfig {
        const id = generateId() as ModelId;
        const ts = now();
        this.db.prepare(`
            INSERT INTO ai_models (id, name, provider_id, model_id, runtime, supports_tools, supports_streaming, params, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            input.name,
            input.providerId,
            input.modelId,
            input.runtime ?? null,
            input.supportsTools == null ? null : (input.supportsTools ? 1 : 0),
            input.supportsStreaming == null ? null : (input.supportsStreaming ? 1 : 0),
            toJSON(input.params),
            ts,
            ts,
        );
        return this.getModel(id)!;
    }

    getModel(id: ModelId): ModelConfig | undefined {
        const row = this.db.prepare('SELECT * FROM ai_models WHERE id = ?').get(id) as any;
        return row ? this.mapModel(row) : undefined;
    }

    listModels(): ModelConfig[] {
        return (this.db.prepare('SELECT * FROM ai_models ORDER BY created_at DESC').all() as any[]).map(r => this.mapModel(r));
    }

    updateModel(id: ModelId, input: Partial<CreateModelInput>): ModelConfig {
        const existing = this.getModel(id);
        if (!existing) throw new Error(`Model not found: ${id}`);
        this.db.prepare(`
            UPDATE ai_models SET name=?, provider_id=?, model_id=?, runtime=?, supports_tools=?, supports_streaming=?, params=?, updated_at=? WHERE id=?
        `).run(
            input.name ?? existing.name,
            input.providerId ?? existing.providerId,
            input.modelId ?? existing.modelId,
            input.runtime ?? existing.runtime ?? null,
            input.supportsTools == null
                ? (existing.supportsTools == null ? null : (existing.supportsTools ? 1 : 0))
                : (input.supportsTools ? 1 : 0),
            input.supportsStreaming == null
                ? (existing.supportsStreaming == null ? null : (existing.supportsStreaming ? 1 : 0))
                : (input.supportsStreaming ? 1 : 0),
            toJSON(input.params ?? existing.params),
            now(),
            id,
        );
        return this.getModel(id)!;
    }

    deleteModel(id: ModelId): void {
        this.db.prepare('DELETE FROM ai_models WHERE id = ?').run(id);
    }

    private mapModel(row: any): ModelConfig {
        return {
            id: row.id, name: row.name, providerId: row.provider_id,
            modelId: row.model_id,
            runtime: row.runtime ?? undefined,
            supportsTools: row.supports_tools == null ? undefined : !!row.supports_tools,
            supportsStreaming: row.supports_streaming == null ? undefined : !!row.supports_streaming,
            params: fromJSON(row.params),
            createdAt: row.created_at, updatedAt: row.updated_at,
        };
    }

    // ── Tools ─────────────────────────────────────────────────────────────

    createTool(input: CreateToolInput): ToolConfig {
        const id = generateId() as ToolConfigId;
        const ts = now();
        this.db.prepare(`
            INSERT INTO ai_tools (id, name, description, parameters_schema, handler_type, handler_config, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, input.name, input.description, toJSON(input.parametersSchema), input.handlerType, toJSON(input.handlerConfig), ts, ts);
        return this.getTool(id)!;
    }

    getTool(id: ToolConfigId): ToolConfig | undefined {
        const row = this.db.prepare('SELECT * FROM ai_tools WHERE id = ?').get(id) as any;
        return row ? this.mapTool(row) : undefined;
    }

    listTools(): ToolConfig[] {
        return (this.db.prepare('SELECT * FROM ai_tools ORDER BY created_at DESC').all() as any[]).map(r => this.mapTool(r));
    }

    updateTool(id: ToolConfigId, input: Partial<CreateToolInput>): ToolConfig {
        const existing = this.getTool(id);
        if (!existing) throw new Error(`Tool not found: ${id}`);
        this.db.prepare(`
            UPDATE ai_tools SET name=?, description=?, parameters_schema=?, handler_type=?, handler_config=?, updated_at=? WHERE id=?
        `).run(
            input.name ?? existing.name, input.description ?? existing.description,
            toJSON(input.parametersSchema ?? existing.parametersSchema),
            input.handlerType ?? existing.handlerType, toJSON(input.handlerConfig ?? existing.handlerConfig),
            now(), id,
        );
        return this.getTool(id)!;
    }

    deleteTool(id: ToolConfigId): void {
        this.db.prepare('DELETE FROM ai_tools WHERE id = ?').run(id);
    }

    private mapTool(row: any): ToolConfig {
        return {
            id: row.id, name: row.name, description: row.description,
            parametersSchema: fromJSON(row.parameters_schema),
            handlerType: row.handler_type, handlerConfig: fromJSON(row.handler_config),
            createdAt: row.created_at, updatedAt: row.updated_at,
        };
    }

    // ── Agents ────────────────────────────────────────────────────────────

    createAgent(input: CreateAgentInput): AgentConfig {
        const id = generateId() as AgentConfigId;
        const ts = now();
        this.db.prepare(`
            INSERT INTO ai_agents (id, name, description, model_id, system_prompt, tool_ids, params, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, input.name, input.description ?? '', input.modelId, input.systemPrompt ?? '', toJSON(input.toolIds ?? []), toJSON(input.params), ts, ts);
        if (input.toolIds && input.toolIds.length > 0) {
            this.setAgentTools(id, input.toolIds);
        }
        return this.getAgent(id)!;
    }

    getAgent(id: AgentConfigId): AgentConfig | undefined {
        const row = this.db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(id) as any;
        return row ? this.mapAgent(row) : undefined;
    }

    listAgents(): AgentConfig[] {
        return (this.db.prepare('SELECT * FROM ai_agents ORDER BY created_at DESC').all() as any[]).map(r => this.mapAgent(r));
    }

    updateAgent(id: AgentConfigId, input: Partial<CreateAgentInput>): AgentConfig {
        const existing = this.getAgent(id);
        if (!existing) throw new Error(`Agent not found: ${id}`);
        const mergedToolIds = input.toolIds ?? existing.toolIds;
        this.db.prepare(`
            UPDATE ai_agents SET name=?, description=?, model_id=?, system_prompt=?, tool_ids=?, params=?, updated_at=? WHERE id=?
        `).run(
            input.name ?? existing.name, input.description ?? existing.description,
            input.modelId ?? existing.modelId, input.systemPrompt ?? existing.systemPrompt,
            toJSON(mergedToolIds), toJSON(input.params ?? existing.params), now(), id,
        );
        if (input.toolIds !== undefined) {
            this.setAgentTools(id, input.toolIds);
        }
        return this.getAgent(id)!;
    }

    deleteAgent(id: AgentConfigId): void {
        this.db.prepare('DELETE FROM ai_agents WHERE id = ?').run(id);
    }

    // ── Agent ↔ Tool m2m ───────────────────────────────────────────────────

    /** Replace the full tool set for an agent (transactional). */
    setAgentTools(agentId: AgentConfigId, toolIds: ToolConfigId[]): void {
        this.db.transaction(() => {
            this.db.prepare('DELETE FROM ai_agent_tools WHERE agent_id = ?').run(agentId);
            const insert = this.db.prepare('INSERT OR IGNORE INTO ai_agent_tools (agent_id, tool_id, sort_order) VALUES (?, ?, ?)');
            for (let i = 0; i < toolIds.length; i++) {
                insert.run(agentId, toolIds[i], i);
            }
        })();
    }

    /** Get the full ToolConfig list for an agent. */
    getAgentTools(agentId: AgentConfigId): ToolConfig[] {
        const rows = this.db.prepare(
            'SELECT t.* FROM ai_tools t JOIN ai_agent_tools at ON t.id = at.tool_id WHERE at.agent_id = ? ORDER BY at.sort_order'
        ).all(agentId) as any[];
        return rows.map(r => this.mapTool(r));
    }

    private mapAgent(row: any): AgentConfig {
        // Read tool IDs from the join table; fall back to legacy JSON column on first access
        const joinRows = this.db.prepare('SELECT tool_id FROM ai_agent_tools WHERE agent_id = ? ORDER BY sort_order').all(row.id) as Array<{ tool_id: string }>;
        const toolIds: ToolConfigId[] = joinRows.length > 0
            ? joinRows.map(r => r.tool_id as ToolConfigId)
            : (fromJSON<string[]>(row.tool_ids) as unknown as ToolConfigId[]);
        return {
            id: row.id, name: row.name, description: row.description,
            modelId: row.model_id, systemPrompt: row.system_prompt,
            toolIds,
            params: fromJSON(row.params), createdAt: row.created_at, updatedAt: row.updated_at,
        };
    }

    // ── Workflows ─────────────────────────────────────────────────────────

    createWorkflow(input: CreateWorkflowInput): WorkflowConfig {
        const id = generateId() as WorkflowId;
        const ts = now();
        this.db.prepare(`
            INSERT INTO ai_workflows (id, name, description, type, nodes, edges, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, input.name, input.description ?? '', input.type, toJSON(input.nodes), toJSON(input.edges), ts, ts);
        return this.getWorkflow(id)!;
    }

    getWorkflow(id: WorkflowId): WorkflowConfig | undefined {
        const row = this.db.prepare('SELECT * FROM ai_workflows WHERE id = ?').get(id) as any;
        return row ? this.mapWorkflow(row) : undefined;
    }

    listWorkflows(): WorkflowConfig[] {
        return (this.db.prepare('SELECT * FROM ai_workflows ORDER BY created_at DESC').all() as any[]).map(r => this.mapWorkflow(r));
    }

    updateWorkflow(id: WorkflowId, input: Partial<CreateWorkflowInput>): WorkflowConfig {
        const existing = this.getWorkflow(id);
        if (!existing) throw new Error(`Workflow not found: ${id}`);
        this.db.prepare(`
            UPDATE ai_workflows SET name=?, description=?, type=?, nodes=?, edges=?, updated_at=? WHERE id=?
        `).run(
            input.name ?? existing.name, input.description ?? existing.description,
            input.type ?? existing.type, toJSON(input.nodes ?? existing.nodes), toJSON(input.edges ?? existing.edges), now(), id,
        );
        return this.getWorkflow(id)!;
    }

    deleteWorkflow(id: WorkflowId): void {
        this.db.prepare('DELETE FROM ai_workflows WHERE id = ?').run(id);
    }

    private mapWorkflow(row: any): WorkflowConfig {
        return {
            id: row.id, name: row.name, description: row.description,
            type: row.type, nodes: fromJSON<any[]>(row.nodes) as any, edges: fromJSON<any[]>(row.edges) as any,
            createdAt: row.created_at, updatedAt: row.updated_at,
        };
    }

    // ── Workflow Executions ──────────────────────────────────────────────

    createWorkflowExecution(input: { workflowId: WorkflowId; input: string }): string {
        const id = generateId();
        const ts = now();
        this.db.prepare(`
            INSERT INTO ai_workflow_executions (id, workflow_id, status, input, started_at)
            VALUES (?, ?, 'running', ?, ?)
        `).run(id, input.workflowId, input.input, ts);
        return id;
    }

    updateWorkflowExecution(id: string, input: { status: 'completed' | 'failed'; finalOutput?: string }): void {
        const ts = now();
        this.db.prepare(`
            UPDATE ai_workflow_executions SET status = ?, final_output = ?, completed_at = ? WHERE id = ?
        `).run(input.status, input.finalOutput ?? null, ts, id);
    }

    createWorkflowStepExecution(input: { executionId: string; nodeId: string }): string {
        const id = generateId();
        const ts = now();
        this.db.prepare(`
            INSERT INTO ai_workflow_step_executions (id, execution_id, node_id, status, started_at)
            VALUES (?, ?, ?, 'running', ?)
        `).run(id, input.executionId, input.nodeId, ts);
        return id;
    }

    updateWorkflowStepExecution(id: string, input: { status: 'completed' | 'failed'; output?: string; error?: string }): void {
        const ts = now();
        this.db.prepare(`
            UPDATE ai_workflow_step_executions SET status = ?, output = ?, error = ?, completed_at = ? WHERE id = ?
        `).run(input.status, input.output ?? null, input.error ?? null, ts, id);
    }

    listWorkflowExecutions(workflowId?: string): import('./types.js').WorkflowExecution[] {
        const rows = workflowId
            ? (this.db.prepare(`
                SELECT e.*, w.name AS workflow_name
                FROM ai_workflow_executions e
                LEFT JOIN ai_workflows w ON e.workflow_id = w.id
                WHERE e.workflow_id = ?
                ORDER BY e.started_at DESC LIMIT 200
              `).all(workflowId) as any[])
            : (this.db.prepare(`
                SELECT e.*, w.name AS workflow_name
                FROM ai_workflow_executions e
                LEFT JOIN ai_workflows w ON e.workflow_id = w.id
                ORDER BY e.started_at DESC LIMIT 200
              `).all() as any[]);
        return rows.map(r => ({
            id: r.id,
            workflowId: r.workflow_id,
            workflowName: r.workflow_name ?? undefined,
            status: r.status,
            input: r.input,
            finalOutput: r.final_output,
            startedAt: r.started_at,
            completedAt: r.completed_at,
        }));
    }

    getWorkflowExecution(id: string): import('./types.js').WorkflowExecution | undefined {
        const r = this.db.prepare(`
            SELECT e.*, w.name AS workflow_name
            FROM ai_workflow_executions e
            LEFT JOIN ai_workflows w ON e.workflow_id = w.id
            WHERE e.id = ?
        `).get(id) as any;
        if (!r) return undefined;
        return { id: r.id, workflowId: r.workflow_id, workflowName: r.workflow_name ?? undefined, status: r.status, input: r.input, finalOutput: r.final_output, startedAt: r.started_at, completedAt: r.completed_at };
    }

    listWorkflowStepExecutions(executionId: string): import('./types.js').WorkflowStepExecution[] {
        const rows = this.db.prepare(`
            SELECT * FROM ai_workflow_step_executions WHERE execution_id = ? ORDER BY started_at ASC
        `).all(executionId) as any[];
        return rows.map(r => ({
            id: r.id,
            executionId: r.execution_id,
            nodeId: r.node_id,
            status: r.status,
            output: r.output,
            error: r.error,
            startedAt: r.started_at,
            completedAt: r.completed_at,
        }));
    }

    // ── Chat Sessions ────────────────────────────────────────────────────

    createChatSession(input: CreateChatSessionInput): ChatSession {
        const id = generateId() as ChatSessionId;
        const ts = now();
        this.db.prepare(`
            INSERT INTO ai_chat_sessions (id, agent_id, workflow_id, model_id, provider_id, mode, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            input.agentId ?? null,
            input.workflowId ?? null,
            input.modelId ?? null,
            input.providerId ?? null,
            input.mode ?? null,
            input.title ?? 'New Chat',
            ts,
            ts,
        );
        // If explicit toolIds OR agentId provided, resolve the initial tool set
        if (input.toolIds && input.toolIds.length > 0) {
            this.setSessionTools(id, input.toolIds);
        } else if (input.agentId) {
            // Inherit the agent's tool set
            const agentToolIds = this.db
                .prepare('SELECT tool_id FROM ai_agent_tools WHERE agent_id = ? ORDER BY sort_order')
                .all(input.agentId) as Array<{ tool_id: string }>;
            if (agentToolIds.length > 0) {
                this.setSessionTools(id, agentToolIds.map(r => r.tool_id as ToolConfigId));
            }
        }
        return this.getChatSession(id)!;
    }

    getChatSession(id: ChatSessionId): ChatSession | undefined {
        const row = this.db.prepare('SELECT * FROM ai_chat_sessions WHERE id = ?').get(id) as any;
        return row ? this.mapChatSession(row) : undefined;
    }

    listChatSessions(): ChatSession[] {
        return (this.db.prepare('SELECT * FROM ai_chat_sessions ORDER BY updated_at DESC').all() as any[]).map(r => this.mapChatSession(r));
    }

    updateChatSession(id: ChatSessionId, input: Partial<CreateChatSessionInput>): ChatSession {
        const existing = this.getChatSession(id);
        if (!existing) throw new Error(`Chat session not found: ${id}`);
        this.db.prepare(`
            UPDATE ai_chat_sessions SET title=?, agent_id=?, workflow_id=?, model_id=?, provider_id=?, mode=?, updated_at=? WHERE id=?
        `).run(
            input.title ?? existing.title,
            input.agentId ?? existing.agentId ?? null,
            input.workflowId ?? existing.workflowId ?? null,
            input.modelId ?? existing.modelId ?? null,
            input.providerId ?? existing.providerId ?? null,
            input.mode ?? existing.mode ?? null,
            now(), id,
        );
        if (input.toolIds !== undefined) {
            this.setSessionTools(id, input.toolIds);
        }
        return this.getChatSession(id)!;
    }

    deleteChatSession(id: ChatSessionId): void {
        this.db.prepare('DELETE FROM ai_chat_sessions WHERE id = ?').run(id);
    }

    // ── Session ↔ Tool m2m ──────────────────────────────────────────────────

    /** Replace the full tool set for a session (transactional). */
    setSessionTools(sessionId: ChatSessionId, toolIds: ToolConfigId[]): void {
        this.db.transaction(() => {
            this.db.prepare('DELETE FROM ai_chat_session_tools WHERE session_id = ?').run(sessionId);
            const insert = this.db.prepare('INSERT OR IGNORE INTO ai_chat_session_tools (session_id, tool_id, sort_order) VALUES (?, ?, ?)');
            for (let i = 0; i < toolIds.length; i++) {
                insert.run(sessionId, toolIds[i], i);
            }
        })();
    }

    /** Get the full ToolConfig list for a session. */
    getSessionTools(sessionId: ChatSessionId): ToolConfig[] {
        const rows = this.db.prepare(
            'SELECT t.* FROM ai_tools t JOIN ai_chat_session_tools st ON t.id = st.tool_id WHERE st.session_id = ? ORDER BY st.sort_order'
        ).all(sessionId) as any[];
        return rows.map(r => this.mapTool(r));
    }

    private mapChatSession(row: any): ChatSession {
        const toolRows = this.db.prepare(
            'SELECT tool_id FROM ai_chat_session_tools WHERE session_id = ? ORDER BY sort_order'
        ).all(row.id) as Array<{ tool_id: string }>;
        return {
            id: row.id,
            agentId: row.agent_id ?? undefined,
            workflowId: row.workflow_id ?? undefined,
            modelId: row.model_id ?? undefined,
            providerId: row.provider_id ?? undefined,
            mode: row.mode ?? undefined,
            title: row.title,
            toolIds: toolRows.map(r => r.tool_id as ToolConfigId),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    // ── Chat Messages ────────────────────────────────────────────────────

    createChatMessage(input: CreateChatMessageInput): ChatMessage {
        const id = generateId() as ChatMessageId;
        const ts = now();
        this.db.prepare(`
            INSERT INTO ai_chat_messages (id, session_id, role, content, provider_type, model_id, tool_calls, tool_results, finish_reason, usage, latency_ms, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            input.sessionId,
            input.role,
            input.content,
            input.providerType ?? null,
            input.modelId ?? null,
            toJSON(input.toolCalls),
            toJSON(input.toolResults),
            input.finishReason ?? null,
            toJSON(input.usage),
            input.latencyMs ?? null,
            toJSON(input.metadata),
            ts,
        );
        // Touch the session updated_at
        this.db.prepare('UPDATE ai_chat_sessions SET updated_at = ? WHERE id = ?').run(ts, input.sessionId);
        return this.getChatMessage(id)!;
    }

    getChatMessage(id: ChatMessageId): ChatMessage | undefined {
        const row = this.db.prepare('SELECT * FROM ai_chat_messages WHERE id = ?').get(id) as any;
        return row ? this.mapChatMessage(row) : undefined;
    }

    listChatMessages(sessionId: ChatSessionId): ChatMessage[] {
        return (this.db.prepare('SELECT * FROM ai_chat_messages WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as any[]).map(r => this.mapChatMessage(r));
    }

    private mapChatMessage(row: any): ChatMessage {
        return {
            id: row.id, sessionId: row.session_id, role: row.role, content: row.content,
            providerType: row.provider_type ?? undefined,
            modelId: row.model_id ?? undefined,
            toolCalls: fromJSON(row.tool_calls), toolResults: fromJSON(row.tool_results),
            finishReason: row.finish_reason ?? undefined,
            usage: fromJSON(row.usage),
            latencyMs: row.latency_ms ?? undefined,
            metadata: fromJSON(row.metadata),
            createdAt: row.created_at,
        };
    }

    // ── Tool Calls ───────────────────────────────────────────────────────

    createToolCall(input: {
        sessionId: ChatSessionId;
        messageId: ChatMessageId;
        toolName: string;
        arguments: string;
        result?: string;
        latencyMs?: number;
    }): void {
        const id = generateId();
        const ts = now();
        this.db.prepare(`
            INSERT INTO ai_tool_calls (id, session_id, message_id, tool_name, arguments, result, latency_ms, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            input.sessionId,
            input.messageId,
            input.toolName,
            input.arguments,
            input.result ?? null,
            input.latencyMs ?? null,
            ts,
        );
    }

    // ── Memory ───────────────────────────────────────────────────────────

    createMemory(input: CreateMemoryInput): MemoryEntry {
        const id = generateId() as MemoryId;
        const ts = now();
        this.db.prepare(`
            INSERT INTO ai_memories (id, session_id, agent_id, content, source_type, importance, topic, entities, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            input.sessionId ?? null,
            input.agentId ?? null,
            input.content,
            input.sourceType ?? null,
            input.importance ?? null,
            input.topic ?? null,
            toJSON(input.entities),
            toJSON(input.metadata),
            ts,
        );
        return this.getMemory(id)!;
    }

    getMemory(id: MemoryId): MemoryEntry | undefined {
        const row = this.db.prepare('SELECT * FROM ai_memories WHERE id = ?').get(id) as any;
        return row ? this.mapMemory(row) : undefined;
    }

    listMemories(agentId?: AgentConfigId): MemoryEntry[] {
        if (agentId) {
            return (this.db.prepare('SELECT * FROM ai_memories WHERE agent_id = ? ORDER BY created_at DESC').all(agentId) as any[]).map(r => this.mapMemory(r));
        }
        return (this.db.prepare('SELECT * FROM ai_memories ORDER BY created_at DESC').all() as any[]).map(r => this.mapMemory(r));
    }

    searchMemories(query: string): MemoryEntry[] {
        const pattern = `%${query}%`;
        return (this.db.prepare('SELECT * FROM ai_memories WHERE content LIKE ? ORDER BY created_at DESC').all(pattern) as any[]).map(r => this.mapMemory(r));
    }

    deleteMemory(id: MemoryId): void {
        this.db.prepare('DELETE FROM ai_memories WHERE id = ?').run(id);
    }

    private mapMemory(row: any): MemoryEntry {
        return {
            id: row.id, sessionId: row.session_id ?? undefined, agentId: row.agent_id ?? undefined,
            content: row.content,
            sourceType: row.source_type ?? undefined,
            importance: row.importance ?? undefined,
            topic: row.topic ?? undefined,
            entities: fromJSON(row.entities),
            metadata: fromJSON(row.metadata),
            createdAt: row.created_at,
        };
    }
}
