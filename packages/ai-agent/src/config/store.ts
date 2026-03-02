/**
 * AI Configuration Store — typed CRUD repository.
 *
 * All entities are persisted in the encrypted SQLite database.
 * JSON columns are transparently (de)serialized.
 */

import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';
import type { RootDatabaseOrm } from '@orch/shared/db';
import type { Logger } from '@orch/daemon';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as diff from 'diff';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { AI_CONFIG_MIGRATION } from './migrations.js';
import {
    generateId,
    type ProviderId, type ModelId, type ToolConfigId, type AgentConfigId,
    type WorkflowId, type ChatSessionId, type ChatMessageId, type MemoryId,
    type McpServerId,
    type ProviderConfig, type CreateProviderInput,
    type ModelConfig, type CreateModelInput,
    type ToolConfig, type CreateToolInput,
    type McpServerConfig, type CreateMcpServerInput,
    type AgentConfig, type CreateAgentInput,
    type WorkflowConfig, type CreateWorkflowInput,
    type ChatSession, type CreateChatSessionInput,
    type ChatMessage, type CreateChatMessageInput,
    type MemoryEntry, type CreateMemoryInput,
    type CanvasId, type CanvasConfig, type CreateCanvasInput, type UpdateCanvasInput,
    type CanvasCommit, type CanvasCommitId,
} from './types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const toJSON = (v: unknown): string => JSON.stringify(v ?? {});
const fromJSON = <T>(v: string | null | undefined): T => (v ? JSON.parse(v) : {} as T);
const now = () => new Date().toISOString();

const aiProvidersTable = sqliteTable('ai_providers', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    adapter: text('adapter'),
    auth_type: text('auth_type'),
    base_url: text('base_url'),
    api_key_ref: text('api_key_ref'),
    headers: text('headers'),
    timeout_ms: integer('timeout_ms'),
    metadata: text('metadata').notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
});

const aiModelsTable = sqliteTable('ai_models', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    provider_id: text('provider_id').notNull(),
    model_id: text('model_id').notNull(),
    runtime: text('runtime'),
    supports_tools: integer('supports_tools'),
    supports_streaming: integer('supports_streaming'),
    params: text('params').notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
});

const aiToolsTable = sqliteTable('ai_tools', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    parameters_schema: text('parameters_schema').notNull(),
    handler_type: text('handler_type').notNull(),
    handler_config: text('handler_config').notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
});

const aiMcpServersTable = sqliteTable('ai_mcp_servers', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    protocol_version: text('protocol_version'),
    capabilities: text('capabilities').notNull(),
    transport: text('transport').notNull(),
    handler_config: text('handler_config').notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
});

const aiAgentsTable = sqliteTable('ai_agents', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    model_id: text('model_id').notNull(),
    system_prompt: text('system_prompt').notNull(),
    tool_ids: text('tool_ids').notNull(),
    params: text('params').notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
});

const aiAgentToolsTable = sqliteTable('ai_agent_tools', {
    agent_id: text('agent_id').notNull(),
    tool_id: text('tool_id').notNull(),
    sort_order: integer('sort_order').notNull(),
});

const aiAgentMcpServersTable = sqliteTable('ai_agent_mcp_servers', {
    agent_id: text('agent_id').notNull(),
    server_id: text('server_id').notNull(),
    sort_order: integer('sort_order').notNull(),
});

const aiWorkflowsTable = sqliteTable('ai_workflows', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    type: text('type').notNull(),
    nodes: text('nodes').notNull(),
    edges: text('edges').notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
});

const aiMemoriesTable = sqliteTable('ai_memories', {
    id: text('id').primaryKey(),
    session_id: text('session_id'),
    agent_id: text('agent_id'),
    content: text('content').notNull(),
    source_type: text('source_type'),
    importance: integer('importance'),
    topic: text('topic'),
    entities: text('entities'),
    metadata: text('metadata').notNull(),
    created_at: text('created_at').notNull(),
});

const aiWorkflowExecutionsTable = sqliteTable('ai_workflow_executions', {
    id: text('id').primaryKey(),
    workflow_id: text('workflow_id').notNull(),
    status: text('status').notNull(),
    input: text('input').notNull(),
    final_output: text('final_output'),
    started_at: text('started_at').notNull(),
    completed_at: text('completed_at'),
});

const aiWorkflowStepExecutionsTable = sqliteTable('ai_workflow_step_executions', {
    id: text('id').primaryKey(),
    execution_id: text('execution_id').notNull(),
    node_id: text('node_id').notNull(),
    status: text('status').notNull(),
    output: text('output'),
    error: text('error'),
    started_at: text('started_at').notNull(),
    completed_at: text('completed_at'),
});

const aiChatSessionsTable = sqliteTable('ai_chat_sessions', {
    id: text('id').primaryKey(),
    agent_id: text('agent_id'),
    workflow_id: text('workflow_id'),
    model_id: text('model_id'),
    provider_id: text('provider_id'),
    mode: text('mode'),
    title: text('title').notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
});

const aiChatSessionToolsTable = sqliteTable('ai_chat_session_tools', {
    session_id: text('session_id').notNull(),
    tool_id: text('tool_id').notNull(),
    sort_order: integer('sort_order').notNull(),
});

const aiChatSessionMcpServersTable = sqliteTable('ai_chat_session_mcp_servers', {
    session_id: text('session_id').notNull(),
    server_id: text('server_id').notNull(),
    sort_order: integer('sort_order').notNull(),
});

const aiChatMessagesTable = sqliteTable('ai_chat_messages', {
    id: text('id').primaryKey(),
    session_id: text('session_id').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    provider_type: text('provider_type'),
    model_id: text('model_id'),
    tool_calls: text('tool_calls').notNull(),
    tool_results: text('tool_results').notNull(),
    finish_reason: text('finish_reason'),
    usage: text('usage'),
    latency_ms: integer('latency_ms'),
    metadata: text('metadata'),
    created_at: text('created_at').notNull(),
});

const aiToolCallsTable = sqliteTable('ai_tool_calls', {
    id: text('id').primaryKey(),
    session_id: text('session_id').notNull(),
    message_id: text('message_id').notNull(),
    tool_name: text('tool_name').notNull(),
    arguments: text('arguments').notNull(),
    result: text('result'),
    latency_ms: integer('latency_ms'),
    created_at: text('created_at').notNull(),
});

const canvasesTable = sqliteTable('canvases', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    content: text('content').notNull(),
    metadata: text('metadata').notNull(),
    owner: text('owner').notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
});

const canvasCommitsTable = sqliteTable('canvas_commits', {
    id: text('id').primaryKey(),
    canvas_id: text('canvas_id').notNull(),
    content: text('content').notNull(),
    diff: text('diff').notNull(),
    metadata: text('metadata').notNull(),
    change_type: text('change_type').notNull(),
    changed_by: text('changed_by').notNull(),
    message: text('message').notNull(),
    created_at: text('created_at').notNull(),
});

// ─── Store ───────────────────────────────────────────────────────────────────

export class AIConfigStore {
    constructor(
        private readonly db: BetterSqlite3.Database,
        private readonly orm: RootDatabaseOrm,
        private readonly logger: Logger,
        private readonly canvasesPath: string = './data/canvases',
    ) { }

    /** Run the idempotent migration. */
    migrate(): void {
        this.db.exec(AI_CONFIG_MIGRATION);
        this.ensureOptionalColumns();
        this.logger.info('AI config tables migrated');
    }

    private ensureOptionalColumns(): void {
        const hasColumn = (table: string, column: string): boolean => {
            const info = this.db.pragma(`table_info(${table})`) as Array<{ name: string }>;
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
            
            CREATE TABLE IF NOT EXISTS ai_agent_mcp_servers (
                agent_id   TEXT NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
                server_id  TEXT NOT NULL REFERENCES ai_mcp_servers(id) ON DELETE CASCADE,
                sort_order INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (agent_id, server_id)
            );
            CREATE INDEX IF NOT EXISTS idx_agent_mcp_servers_agent ON ai_agent_mcp_servers(agent_id);
            CREATE TABLE IF NOT EXISTS ai_chat_session_mcp_servers (
                session_id TEXT NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
                server_id  TEXT NOT NULL REFERENCES ai_mcp_servers(id) ON DELETE CASCADE,
                sort_order INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (session_id, server_id)
            );
            CREATE INDEX IF NOT EXISTS idx_session_mcp_servers_session ON ai_chat_session_mcp_servers(session_id);
        `);

        // One-time migration: populate ai_agent_tools from legacy tool_ids JSON column
        this.migrateAgentToolsJson();
    }

    /**
     * Migrate legacy tool_ids JSON array from ai_agents into ai_agent_tools join table.
     * Runs once per boot, skips agents that already have join table entries.
     */
    private migrateAgentToolsJson(): void {
        const agents = this.orm
            .select({ id: aiAgentsTable.id, tool_ids: aiAgentsTable.tool_ids })
            .from(aiAgentsTable)
            .all() as Array<{ id: string; tool_ids: string | null }>;

        const migrate = (agentId: string, toolIds: string[]) => {
            for (let i = 0; i < toolIds.length; i++) {
                try {
                    this.orm
                        .insert(aiAgentToolsTable)
                        .values({ agent_id: agentId, tool_id: toolIds[i], sort_order: i })
                        .onConflictDoNothing()
                        .run();
                } catch {
                    // Tool may have been deleted already; keep migration best-effort.
                }
            }
        };

        for (const agent of agents) {
            const existing = this.orm
                .select({ cnt: sql<number>`count(*)` })
                .from(aiAgentToolsTable)
                .where(eq(aiAgentToolsTable.agent_id, agent.id))
                .get()?.cnt ?? 0;
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
        this.orm.insert(aiProvidersTable).values({
            id,
            name: input.name,
            type: input.type,
            adapter: input.adapter ?? null,
            auth_type: input.authType ?? null,
            base_url: input.baseUrl ?? null,
            api_key_ref: input.apiKeyRef ?? null,
            headers: toJSON(input.headers),
            timeout_ms: input.timeoutMs ?? null,
            metadata: toJSON(input.metadata),
            created_at: ts,
            updated_at: ts,
        }).run();
        return this.getProvider(id)!;
    }

    getProvider(id: ProviderId): ProviderConfig | undefined {
        const row = this.orm.select().from(aiProvidersTable).where(eq(aiProvidersTable.id, id)).get() as any;
        return row ? this.mapProvider(row) : undefined;
    }

    listProviders(): ProviderConfig[] {
        return (this.orm.select().from(aiProvidersTable).orderBy(desc(aiProvidersTable.created_at)).all() as any[]).map(r => this.mapProvider(r));
    }

    updateProvider(id: ProviderId, input: Partial<CreateProviderInput>): ProviderConfig {
        const existing = this.getProvider(id);
        if (!existing) throw new Error(`Provider not found: ${id}`);
        this.orm.update(aiProvidersTable).set({
            name: input.name ?? existing.name,
            type: input.type ?? existing.type,
            adapter: input.adapter ?? existing.adapter ?? null,
            auth_type: input.authType ?? existing.authType ?? null,
            base_url: input.baseUrl ?? existing.baseUrl ?? null,
            api_key_ref: input.apiKeyRef ?? existing.apiKeyRef ?? null,
            headers: toJSON(input.headers ?? existing.headers),
            timeout_ms: input.timeoutMs ?? existing.timeoutMs ?? null,
            metadata: toJSON(input.metadata ?? existing.metadata),
            updated_at: now(),
        }).where(eq(aiProvidersTable.id, id)).run();
        return this.getProvider(id)!;
    }

    deleteProvider(id: ProviderId): void {
        this.orm.delete(aiProvidersTable).where(eq(aiProvidersTable.id, id)).run();
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
        this.orm.insert(aiModelsTable).values({
            id,
            name: input.name,
            provider_id: input.providerId,
            model_id: input.modelId,
            runtime: input.runtime ?? null,
            supports_tools: input.supportsTools == null ? null : (input.supportsTools ? 1 : 0),
            supports_streaming: input.supportsStreaming == null ? null : (input.supportsStreaming ? 1 : 0),
            params: toJSON(input.params),
            created_at: ts,
            updated_at: ts,
        }).run();
        return this.getModel(id)!;
    }

    getModel(id: ModelId): ModelConfig | undefined {
        const row = this.orm.select().from(aiModelsTable).where(eq(aiModelsTable.id, id)).get() as any;
        return row ? this.mapModel(row) : undefined;
    }

    listModels(): ModelConfig[] {
        return (this.orm.select().from(aiModelsTable).orderBy(desc(aiModelsTable.created_at)).all() as any[]).map(r => this.mapModel(r));
    }

    updateModel(id: ModelId, input: Partial<CreateModelInput>): ModelConfig {
        const existing = this.getModel(id);
        if (!existing) throw new Error(`Model not found: ${id}`);
        this.orm.update(aiModelsTable).set({
            name: input.name ?? existing.name,
            provider_id: input.providerId ?? existing.providerId,
            model_id: input.modelId ?? existing.modelId,
            runtime: input.runtime ?? existing.runtime ?? null,
            supports_tools: input.supportsTools == null
                ? (existing.supportsTools == null ? null : (existing.supportsTools ? 1 : 0))
                : (input.supportsTools ? 1 : 0),
            supports_streaming: input.supportsStreaming == null
                ? (existing.supportsStreaming == null ? null : (existing.supportsStreaming ? 1 : 0))
                : (input.supportsStreaming ? 1 : 0),
            params: toJSON(input.params ?? existing.params),
            updated_at: now(),
        }).where(eq(aiModelsTable.id, id)).run();
        return this.getModel(id)!;
    }

    deleteModel(id: ModelId): void {
        this.orm.delete(aiModelsTable).where(eq(aiModelsTable.id, id)).run();
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
        this.orm.insert(aiToolsTable).values({
            id,
            name: input.name,
            description: input.description,
            parameters_schema: toJSON(input.parametersSchema),
            handler_type: input.handlerType,
            handler_config: toJSON(input.handlerConfig),
            created_at: ts,
            updated_at: ts,
        }).run();
        return this.getTool(id)!;
    }

    getTool(id: ToolConfigId): ToolConfig | undefined {
        const row = this.orm.select().from(aiToolsTable).where(eq(aiToolsTable.id, id)).get() as any;
        return row ? this.mapTool(row) : undefined;
    }

    listTools(): ToolConfig[] {
        return (this.orm.select().from(aiToolsTable).orderBy(desc(aiToolsTable.created_at)).all() as any[]).map(r => this.mapTool(r));
    }

    updateTool(id: ToolConfigId, input: Partial<CreateToolInput>): ToolConfig {
        const existing = this.getTool(id);
        if (!existing) throw new Error(`Tool not found: ${id}`);
        this.orm.update(aiToolsTable).set({
            name: input.name ?? existing.name,
            description: input.description ?? existing.description,
            parameters_schema: toJSON(input.parametersSchema ?? existing.parametersSchema),
            handler_type: input.handlerType ?? existing.handlerType,
            handler_config: toJSON(input.handlerConfig ?? existing.handlerConfig),
            updated_at: now(),
        }).where(eq(aiToolsTable.id, id)).run();
        return this.getTool(id)!;
    }

    deleteTool(id: ToolConfigId): void {
        this.orm.delete(aiToolsTable).where(eq(aiToolsTable.id, id)).run();
    }

    private mapTool(row: any): ToolConfig {
        return {
            id: row.id, name: row.name, description: row.description,
            parametersSchema: fromJSON(row.parameters_schema),
            handlerType: row.handler_type, handlerConfig: fromJSON(row.handler_config),
            createdAt: row.created_at, updatedAt: row.updated_at,
        };
    }

    // ── MCP Servers ───────────────────────────────────────────────────────

    createMcpServer(input: CreateMcpServerInput): McpServerConfig {
        const id = generateId() as McpServerId;
        const ts = now();
        this.orm.insert(aiMcpServersTable).values({
            id,
            name: input.name,
            protocol_version: input.protocolVersion ?? null,
            capabilities: toJSON(input.capabilities ?? []),
            transport: input.transport,
            handler_config: toJSON(input.handlerConfig),
            created_at: ts,
            updated_at: ts,
        }).run();
        return this.getMcpServer(id)!;
    }

    getMcpServer(id: McpServerId): McpServerConfig | undefined {
        const row = this.orm.select().from(aiMcpServersTable).where(eq(aiMcpServersTable.id, id)).get() as any;
        return row ? this.mapMcpServer(row) : undefined;
    }

    listMcpServers(): McpServerConfig[] {
        return (this.orm.select().from(aiMcpServersTable).orderBy(desc(aiMcpServersTable.created_at)).all() as any[]).map(r => this.mapMcpServer(r));
    }

    updateMcpServer(id: McpServerId, input: Partial<CreateMcpServerInput>): McpServerConfig {
        const existing = this.getMcpServer(id);
        if (!existing) throw new Error(`MCP Server not found: ${id}`);
        this.orm.update(aiMcpServersTable).set({
            name: input.name ?? existing.name,
            protocol_version: input.protocolVersion ?? existing.protocolVersion ?? null,
            capabilities: toJSON(input.capabilities ?? existing.capabilities),
            transport: input.transport ?? existing.transport,
            handler_config: toJSON(input.handlerConfig ?? existing.handlerConfig),
            updated_at: now(),
        }).where(eq(aiMcpServersTable.id, id)).run();
        return this.getMcpServer(id)!;
    }

    deleteMcpServer(id: McpServerId): void {
        this.orm.delete(aiMcpServersTable).where(eq(aiMcpServersTable.id, id)).run();
    }

    private mapMcpServer(row: any): McpServerConfig {
        return {
            id: row.id, name: row.name,
            protocolVersion: row.protocol_version ?? undefined,
            capabilities: fromJSON(row.capabilities),
            transport: row.transport,
            handlerConfig: fromJSON(row.handler_config),
            createdAt: row.created_at, updatedAt: row.updated_at,
        };
    }

    // ── Agents ────────────────────────────────────────────────────────────

    createAgent(input: CreateAgentInput): AgentConfig {
        const id = generateId() as AgentConfigId;
        const ts = now();
        this.orm.insert(aiAgentsTable).values({
            id,
            name: input.name,
            description: input.description ?? '',
            model_id: input.modelId,
            system_prompt: input.systemPrompt ?? '',
            tool_ids: toJSON(input.toolIds ?? []),
            params: toJSON(input.params),
            created_at: ts,
            updated_at: ts,
        }).run();
        if (input.toolIds && input.toolIds.length > 0) {
            this.setAgentTools(id, input.toolIds);
        }
        if (input.mcpServerIds && input.mcpServerIds.length > 0) {
            this.setAgentMcpServers(id, input.mcpServerIds);
        }
        return this.getAgent(id)!;
    }

    getAgent(id: AgentConfigId): AgentConfig | undefined {
        const row = this.orm.select().from(aiAgentsTable).where(eq(aiAgentsTable.id, id)).get() as any;
        return row ? this.mapAgent(row) : undefined;
    }

    listAgents(): AgentConfig[] {
        return (this.orm.select().from(aiAgentsTable).orderBy(desc(aiAgentsTable.created_at)).all() as any[]).map(r => this.mapAgent(r));
    }

    updateAgent(id: AgentConfigId, input: Partial<CreateAgentInput>): AgentConfig {
        const existing = this.getAgent(id);
        if (!existing) throw new Error(`Agent not found: ${id}`);
        const mergedToolIds = input.toolIds ?? existing.toolIds;
        this.orm.update(aiAgentsTable).set({
            name: input.name ?? existing.name,
            description: input.description ?? existing.description,
            model_id: input.modelId ?? existing.modelId,
            system_prompt: input.systemPrompt ?? existing.systemPrompt,
            tool_ids: toJSON(mergedToolIds),
            params: toJSON(input.params ?? existing.params),
            updated_at: now(),
        }).where(eq(aiAgentsTable.id, id)).run();
        if (input.toolIds !== undefined) {
            this.setAgentTools(id, input.toolIds);
        }
        if (input.mcpServerIds !== undefined) {
            this.setAgentMcpServers(id, input.mcpServerIds);
        }
        return this.getAgent(id)!;
    }

    deleteAgent(id: AgentConfigId): void {
        this.orm.delete(aiAgentsTable).where(eq(aiAgentsTable.id, id)).run();
    }

    // ── Agent ↔ Tool m2m ───────────────────────────────────────────────────

    /** Replace the full tool set for an agent (transactional). */
    setAgentTools(agentId: AgentConfigId, toolIds: ToolConfigId[]): void {
        this.orm.delete(aiAgentToolsTable).where(eq(aiAgentToolsTable.agent_id, agentId)).run();
        for (let i = 0; i < toolIds.length; i++) {
            this.orm
                .insert(aiAgentToolsTable)
                .values({ agent_id: agentId, tool_id: toolIds[i], sort_order: i })
                .onConflictDoNothing()
                .run();
        }
    }

    /** Get the full ToolConfig list for an agent. */
    getAgentTools(agentId: AgentConfigId): ToolConfig[] {
        const toolIds = this.orm
            .select({ tool_id: aiAgentToolsTable.tool_id })
            .from(aiAgentToolsTable)
            .where(eq(aiAgentToolsTable.agent_id, agentId))
            .orderBy(aiAgentToolsTable.sort_order)
            .all() as Array<{ tool_id: string }>;
        if (toolIds.length === 0) {
            return [];
        }
        const rows = this.orm
            .select()
            .from(aiToolsTable)
            .where(inArray(aiToolsTable.id, toolIds.map((t) => t.tool_id)))
            .all() as any[];
        return rows.map(r => this.mapTool(r));
    }

    // ── Agent ↔ MCP Server m2m ─────────────────────────────────────────────

    setAgentMcpServers(agentId: AgentConfigId, serverIds: McpServerId[]): void {
        this.orm.delete(aiAgentMcpServersTable).where(eq(aiAgentMcpServersTable.agent_id, agentId)).run();
        for (let i = 0; i < serverIds.length; i++) {
            this.orm
                .insert(aiAgentMcpServersTable)
                .values({ agent_id: agentId, server_id: serverIds[i], sort_order: i })
                .onConflictDoNothing()
                .run();
        }
    }

    getAgentMcpServers(agentId: AgentConfigId): McpServerConfig[] {
        const serverIds = this.orm
            .select({ server_id: aiAgentMcpServersTable.server_id })
            .from(aiAgentMcpServersTable)
            .where(eq(aiAgentMcpServersTable.agent_id, agentId))
            .orderBy(aiAgentMcpServersTable.sort_order)
            .all() as Array<{ server_id: string }>;
        if (serverIds.length === 0) {
            return [];
        }
        const rows = this.orm
            .select()
            .from(aiMcpServersTable)
            .where(inArray(aiMcpServersTable.id, serverIds.map((s) => s.server_id)))
            .all() as any[];
        return rows.map(r => this.mapMcpServer(r));
    }

    private mapAgent(row: any): AgentConfig {
        // Read tool IDs from the join table; fall back to legacy JSON column on first access
        const joinRows = this.orm
            .select({ tool_id: aiAgentToolsTable.tool_id })
            .from(aiAgentToolsTable)
            .where(eq(aiAgentToolsTable.agent_id, row.id))
            .orderBy(aiAgentToolsTable.sort_order)
            .all() as Array<{ tool_id: string }>;
        const toolIds: ToolConfigId[] = joinRows.length > 0
            ? joinRows.map(r => r.tool_id as ToolConfigId)
            : (fromJSON<string[]>(row.tool_ids) as unknown as ToolConfigId[]);
            
        const mcpRows = this.orm
            .select({ server_id: aiAgentMcpServersTable.server_id })
            .from(aiAgentMcpServersTable)
            .where(eq(aiAgentMcpServersTable.agent_id, row.id))
            .orderBy(aiAgentMcpServersTable.sort_order)
            .all() as Array<{ server_id: string }>;
        const mcpServerIds: McpServerId[] = mcpRows.map(r => r.server_id as McpServerId);

        return {
            id: row.id, name: row.name, description: row.description,
            modelId: row.model_id, systemPrompt: row.system_prompt,
            toolIds,
            mcpServerIds,
            params: fromJSON(row.params), createdAt: row.created_at, updatedAt: row.updated_at,
        };
    }

    // ── Workflows ─────────────────────────────────────────────────────────

    createWorkflow(input: CreateWorkflowInput): WorkflowConfig {
        const id = generateId() as WorkflowId;
        const ts = now();
        this.orm.insert(aiWorkflowsTable).values({
            id,
            name: input.name,
            description: input.description ?? '',
            type: input.type,
            nodes: toJSON(input.nodes),
            edges: toJSON(input.edges),
            created_at: ts,
            updated_at: ts,
        }).run();
        return this.getWorkflow(id)!;
    }

    getWorkflow(id: WorkflowId): WorkflowConfig | undefined {
        const row = this.orm.select().from(aiWorkflowsTable).where(eq(aiWorkflowsTable.id, id)).get() as any;
        return row ? this.mapWorkflow(row) : undefined;
    }

    listWorkflows(): WorkflowConfig[] {
        return (this.orm.select().from(aiWorkflowsTable).orderBy(desc(aiWorkflowsTable.created_at)).all() as any[]).map(r => this.mapWorkflow(r));
    }

    updateWorkflow(id: WorkflowId, input: Partial<CreateWorkflowInput>): WorkflowConfig {
        const existing = this.getWorkflow(id);
        if (!existing) throw new Error(`Workflow not found: ${id}`);
        this.orm.update(aiWorkflowsTable).set({
            name: input.name ?? existing.name,
            description: input.description ?? existing.description,
            type: input.type ?? existing.type,
            nodes: toJSON(input.nodes ?? existing.nodes),
            edges: toJSON(input.edges ?? existing.edges),
            updated_at: now(),
        }).where(eq(aiWorkflowsTable.id, id)).run();
        return this.getWorkflow(id)!;
    }

    deleteWorkflow(id: WorkflowId): void {
        this.orm.delete(aiWorkflowsTable).where(eq(aiWorkflowsTable.id, id)).run();
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
        this.orm.insert(aiWorkflowExecutionsTable).values({
            id,
            workflow_id: input.workflowId,
            status: 'running',
            input: input.input,
            started_at: ts,
            final_output: null,
            completed_at: null,
        }).run();
        return id;
    }

    updateWorkflowExecution(id: string, input: { status: 'completed' | 'failed'; finalOutput?: string }): void {
        const ts = now();
        this.orm.update(aiWorkflowExecutionsTable)
            .set({ status: input.status, final_output: input.finalOutput ?? null, completed_at: ts })
            .where(eq(aiWorkflowExecutionsTable.id, id))
            .run();
    }

    createWorkflowStepExecution(input: { executionId: string; nodeId: string }): string {
        const id = generateId();
        const ts = now();
        this.orm.insert(aiWorkflowStepExecutionsTable).values({
            id,
            execution_id: input.executionId,
            node_id: input.nodeId,
            status: 'running',
            started_at: ts,
            output: null,
            error: null,
            completed_at: null,
        }).run();
        return id;
    }

    updateWorkflowStepExecution(id: string, input: { status: 'completed' | 'failed'; output?: string; error?: string }): void {
        const ts = now();
        this.orm.update(aiWorkflowStepExecutionsTable)
            .set({ status: input.status, output: input.output ?? null, error: input.error ?? null, completed_at: ts })
            .where(eq(aiWorkflowStepExecutionsTable.id, id))
            .run();
    }

    listWorkflowExecutions(workflowId?: string): import('./types.js').WorkflowExecution[] {
        const wfRows = this.orm.select({ id: aiWorkflowsTable.id, name: aiWorkflowsTable.name }).from(aiWorkflowsTable).all() as Array<{ id: string; name: string }>;
        const wfMap = new Map<string, string>(wfRows.map((w) => [w.id, w.name]));
        const base = this.orm
            .select()
            .from(aiWorkflowExecutionsTable)
            .orderBy(desc(aiWorkflowExecutionsTable.started_at))
            .limit(200);
        const rows = (workflowId
            ? base.where(eq(aiWorkflowExecutionsTable.workflow_id, workflowId)).all()
            : base.all()) as any[];
        return rows.map(r => ({
            id: r.id,
            workflowId: r.workflow_id,
            workflowName: wfMap.get(r.workflow_id),
            status: r.status,
            input: r.input,
            finalOutput: r.final_output,
            startedAt: r.started_at,
            completedAt: r.completed_at,
        }));
    }

    getWorkflowExecution(id: string): import('./types.js').WorkflowExecution | undefined {
        const r = this.orm.select().from(aiWorkflowExecutionsTable).where(eq(aiWorkflowExecutionsTable.id, id)).get() as any;
        if (!r) return undefined;
        const wf = this.orm.select({ name: aiWorkflowsTable.name }).from(aiWorkflowsTable).where(eq(aiWorkflowsTable.id, r.workflow_id)).get() as { name: string } | undefined;
        return { id: r.id, workflowId: r.workflow_id, workflowName: wf?.name, status: r.status, input: r.input, finalOutput: r.final_output, startedAt: r.started_at, completedAt: r.completed_at };
    }

    listWorkflowStepExecutions(executionId: string): import('./types.js').WorkflowStepExecution[] {
        const rows = this.orm
            .select()
            .from(aiWorkflowStepExecutionsTable)
            .where(eq(aiWorkflowStepExecutionsTable.execution_id, executionId))
            .orderBy(asc(aiWorkflowStepExecutionsTable.started_at))
            .all() as any[];
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
        this.orm.insert(aiChatSessionsTable).values({
            id,
            agent_id: input.agentId ?? null,
            workflow_id: input.workflowId ?? null,
            model_id: input.modelId ?? null,
            provider_id: input.providerId ?? null,
            mode: input.mode ?? null,
            title: input.title ?? 'New Chat',
            created_at: ts,
            updated_at: ts,
        }).run();
        // If explicit toolIds OR agentId provided, resolve the initial tool set
        if (input.toolIds && input.toolIds.length > 0) {
            this.setSessionTools(id, input.toolIds);
        } else if (input.agentId) {
            const agentToolIds = this.orm
                .select({ tool_id: aiAgentToolsTable.tool_id })
                .from(aiAgentToolsTable)
                .where(eq(aiAgentToolsTable.agent_id, input.agentId))
                .orderBy(aiAgentToolsTable.sort_order)
                .all() as Array<{ tool_id: string }>;
            if (agentToolIds.length > 0) {
                this.setSessionTools(id, agentToolIds.map(r => r.tool_id as ToolConfigId));
            }
        }
        
        if (input.mcpServerIds && input.mcpServerIds.length > 0) {
            this.setSessionMcpServers(id, input.mcpServerIds);
        } else if (input.agentId) {
            const agentMcpServerIds = this.orm
                .select({ server_id: aiAgentMcpServersTable.server_id })
                .from(aiAgentMcpServersTable)
                .where(eq(aiAgentMcpServersTable.agent_id, input.agentId))
                .orderBy(aiAgentMcpServersTable.sort_order)
                .all() as Array<{ server_id: string }>;
            if (agentMcpServerIds.length > 0) {
                this.setSessionMcpServers(id, agentMcpServerIds.map(r => r.server_id as McpServerId));
            }
        }
        
        return this.getChatSession(id)!;
    }

    getChatSession(id: ChatSessionId): ChatSession | undefined {
        const row = this.orm.select().from(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, id)).get() as any;
        return row ? this.mapChatSession(row) : undefined;
    }

    listChatSessions(): ChatSession[] {
        return (this.orm.select().from(aiChatSessionsTable).orderBy(desc(aiChatSessionsTable.updated_at)).all() as any[]).map(r => this.mapChatSession(r));
    }

    updateChatSession(id: ChatSessionId, input: Partial<CreateChatSessionInput>): ChatSession {
        const existing = this.getChatSession(id);
        if (!existing) throw new Error(`Chat session not found: ${id}`);
        this.orm.update(aiChatSessionsTable).set({
            title: input.title ?? existing.title,
            agent_id: input.agentId ?? existing.agentId ?? null,
            workflow_id: input.workflowId ?? existing.workflowId ?? null,
            model_id: input.modelId ?? existing.modelId ?? null,
            provider_id: input.providerId ?? existing.providerId ?? null,
            mode: input.mode ?? existing.mode ?? null,
            updated_at: now(),
        }).where(eq(aiChatSessionsTable.id, id)).run();
        if (input.toolIds !== undefined) {
            this.setSessionTools(id, input.toolIds);
        }
        if (input.mcpServerIds !== undefined) {
            this.setSessionMcpServers(id, input.mcpServerIds);
        }
        return this.getChatSession(id)!;
    }

    deleteChatSession(id: ChatSessionId): void {
        this.orm.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, id)).run();
    }

    // ── Session ↔ Tool m2m ──────────────────────────────────────────────────

    /** Replace the full tool set for a session (transactional). */
    setSessionTools(sessionId: ChatSessionId, toolIds: ToolConfigId[]): void {
        this.orm.delete(aiChatSessionToolsTable).where(eq(aiChatSessionToolsTable.session_id, sessionId)).run();
        for (let i = 0; i < toolIds.length; i++) {
            this.orm
                .insert(aiChatSessionToolsTable)
                .values({ session_id: sessionId, tool_id: toolIds[i], sort_order: i })
                .onConflictDoNothing()
                .run();
        }
    }

    /** Get the full ToolConfig list for a session. */
    getSessionTools(sessionId: ChatSessionId): ToolConfig[] {
        const toolIds = this.orm
            .select({ tool_id: aiChatSessionToolsTable.tool_id })
            .from(aiChatSessionToolsTable)
            .where(eq(aiChatSessionToolsTable.session_id, sessionId))
            .orderBy(aiChatSessionToolsTable.sort_order)
            .all() as Array<{ tool_id: string }>;
        if (toolIds.length === 0) {
            return [];
        }
        const rows = this.orm
            .select()
            .from(aiToolsTable)
            .where(inArray(aiToolsTable.id, toolIds.map((t) => t.tool_id)))
            .all() as any[];
        return rows.map(r => this.mapTool(r));
    }

    // ── Session ↔ MCP Server m2m ────────────────────────────────────────────

    setSessionMcpServers(sessionId: ChatSessionId, serverIds: McpServerId[]): void {
        this.orm.delete(aiChatSessionMcpServersTable).where(eq(aiChatSessionMcpServersTable.session_id, sessionId)).run();
        for (let i = 0; i < serverIds.length; i++) {
            this.orm
                .insert(aiChatSessionMcpServersTable)
                .values({ session_id: sessionId, server_id: serverIds[i], sort_order: i })
                .onConflictDoNothing()
                .run();
        }
    }

    getSessionMcpServers(sessionId: ChatSessionId): McpServerConfig[] {
        const serverIds = this.orm
            .select({ server_id: aiChatSessionMcpServersTable.server_id })
            .from(aiChatSessionMcpServersTable)
            .where(eq(aiChatSessionMcpServersTable.session_id, sessionId))
            .orderBy(aiChatSessionMcpServersTable.sort_order)
            .all() as Array<{ server_id: string }>;
        if (serverIds.length === 0) {
            return [];
        }
        const rows = this.orm
            .select()
            .from(aiMcpServersTable)
            .where(inArray(aiMcpServersTable.id, serverIds.map((s) => s.server_id)))
            .all() as any[];
        return rows.map(r => this.mapMcpServer(r));
    }

    private mapChatSession(row: any): ChatSession {
        const toolRows = this.orm
            .select({ tool_id: aiChatSessionToolsTable.tool_id })
            .from(aiChatSessionToolsTable)
            .where(eq(aiChatSessionToolsTable.session_id, row.id))
            .orderBy(aiChatSessionToolsTable.sort_order)
            .all() as Array<{ tool_id: string }>;
        const mcpRows = this.orm
            .select({ server_id: aiChatSessionMcpServersTable.server_id })
            .from(aiChatSessionMcpServersTable)
            .where(eq(aiChatSessionMcpServersTable.session_id, row.id))
            .orderBy(aiChatSessionMcpServersTable.sort_order)
            .all() as Array<{ server_id: string }>;
        return {
            id: row.id,
            agentId: row.agent_id ?? undefined,
            workflowId: row.workflow_id ?? undefined,
            modelId: row.model_id ?? undefined,
            providerId: row.provider_id ?? undefined,
            mode: row.mode ?? undefined,
            title: row.title,
            toolIds: toolRows.map(r => r.tool_id as ToolConfigId),
            mcpServerIds: mcpRows.map(r => r.server_id as McpServerId),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    // ── Chat Messages ────────────────────────────────────────────────────

    createChatMessage(input: CreateChatMessageInput): ChatMessage {
        const id = generateId() as ChatMessageId;
        const ts = now();
        this.orm.insert(aiChatMessagesTable).values({
            id,
            session_id: input.sessionId,
            role: input.role,
            content: input.content,
            provider_type: input.providerType ?? null,
            model_id: input.modelId ?? null,
            tool_calls: toJSON(input.toolCalls),
            tool_results: toJSON(input.toolResults),
            finish_reason: input.finishReason ?? null,
            usage: toJSON(input.usage),
            latency_ms: input.latencyMs ?? null,
            metadata: toJSON(input.metadata),
            created_at: ts,
        }).run();
        // Touch the session updated_at
        this.orm.update(aiChatSessionsTable).set({ updated_at: ts }).where(eq(aiChatSessionsTable.id, input.sessionId)).run();
        return this.getChatMessage(id)!;
    }

    getChatMessage(id: ChatMessageId): ChatMessage | undefined {
        const row = this.orm.select().from(aiChatMessagesTable).where(eq(aiChatMessagesTable.id, id)).get() as any;
        return row ? this.mapChatMessage(row) : undefined;
    }

    listChatMessages(sessionId: ChatSessionId): ChatMessage[] {
        return (this.orm
            .select()
            .from(aiChatMessagesTable)
            .where(eq(aiChatMessagesTable.session_id, sessionId))
            .orderBy(asc(aiChatMessagesTable.created_at))
            .all() as any[]).map(r => this.mapChatMessage(r));
    }

    listChatMessagesUpTo(sessionId: ChatSessionId, messageId: ChatMessageId): ChatMessage[] {
        const allMessages = this.listChatMessages(sessionId);
        const idx = allMessages.findIndex((m) => m.id === messageId);
        if (idx < 0) {
            throw new Error(`Chat message not found in session: ${messageId}`);
        }
        return allMessages.slice(0, idx + 1);
    }

    deleteChatMessagesAfter(sessionId: ChatSessionId, messageId: ChatMessageId): number {
        const allMessages = this.listChatMessages(sessionId);
        const idx = allMessages.findIndex((m) => m.id === messageId);
        if (idx < 0) {
            throw new Error(`Chat message not found in session: ${messageId}`);
        }

        const ids = allMessages.slice(idx + 1).map((m) => m.id);
        if (ids.length === 0) {
            return 0;
        }
        const result = this.orm
            .delete(aiChatMessagesTable)
            .where(inArray(aiChatMessagesTable.id, ids))
            .run();
        this.orm.update(aiChatSessionsTable).set({ updated_at: now() }).where(eq(aiChatSessionsTable.id, sessionId)).run();
        return result.changes;
    }

    deleteChatMessagesBefore(sessionId: ChatSessionId, messageId: ChatMessageId): number {
        const allMessages = this.listChatMessages(sessionId);
        const idx = allMessages.findIndex((m) => m.id === messageId);
        if (idx < 0) {
            throw new Error(`Chat message not found in session: ${messageId}`);
        }

        const ids = allMessages.slice(0, idx).map((m) => m.id);
        if (ids.length === 0) {
            return 0;
        }
        const result = this.orm
            .delete(aiChatMessagesTable)
            .where(inArray(aiChatMessagesTable.id, ids))
            .run();
        this.orm.update(aiChatSessionsTable).set({ updated_at: now() }).where(eq(aiChatSessionsTable.id, sessionId)).run();
        return result.changes;
    }

    forkChatSessionUpTo(
        sessionId: ChatSessionId,
        messageId: ChatMessageId,
        title?: string,
    ): ChatSession {
        const sourceSession = this.getChatSession(sessionId);
        if (!sourceSession) {
            throw new Error(`Chat session not found: ${sessionId}`);
        }

        const messagesToCopy = this.listChatMessagesUpTo(sessionId, messageId);
        if (messagesToCopy.length === 0) {
            throw new Error(`No messages to fork for session: ${sessionId}`);
        }

        const forkTitle = title?.trim() || `${sourceSession.title} (Fork)`;
        const forkedSession = this.createChatSession({
            agentId: sourceSession.agentId,
            workflowId: sourceSession.workflowId,
            modelId: sourceSession.modelId,
            providerId: sourceSession.providerId,
            mode: sourceSession.mode,
            title: forkTitle,
            toolIds: sourceSession.toolIds,
            mcpServerIds: sourceSession.mcpServerIds,
        });

        const copyMessages = this.db.transaction((msgs: ChatMessage[]) => {
            for (const message of msgs) {
                this.createChatMessage({
                    sessionId: forkedSession.id,
                    role: message.role,
                    content: message.content,
                    providerType: message.providerType,
                    modelId: message.modelId,
                    toolCalls: message.toolCalls,
                    toolResults: message.toolResults,
                    finishReason: message.finishReason,
                    usage: message.usage,
                    latencyMs: message.latencyMs,
                    metadata: message.metadata,
                });
            }
        });

        copyMessages(messagesToCopy);
        return this.getChatSession(forkedSession.id)!;
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
        this.orm.insert(aiToolCallsTable).values({
            id,
            session_id: input.sessionId,
            message_id: input.messageId,
            tool_name: input.toolName,
            arguments: input.arguments,
            result: input.result ?? null,
            latency_ms: input.latencyMs ?? null,
            created_at: ts,
        }).run();
    }

    createToolCalls(inputs: Array<{
        sessionId: ChatSessionId;
        messageId: ChatMessageId;
        toolName: string;
        arguments: string;
        result?: string;
        latencyMs?: number;
    }>): void {
        const ts = now();
        for (const item of inputs) {
            this.orm.insert(aiToolCallsTable).values({
                id: generateId(),
                session_id: item.sessionId,
                message_id: item.messageId,
                tool_name: item.toolName,
                arguments: item.arguments,
                result: item.result ?? null,
                latency_ms: item.latencyMs ?? null,
                created_at: ts,
            }).run();
        }
    }

    // ── Memory ───────────────────────────────────────────────────────────

    createMemory(input: CreateMemoryInput): MemoryEntry {
        const id = generateId() as MemoryId;
        const ts = now();
        this.orm.insert(aiMemoriesTable).values({
            id,
            session_id: input.sessionId ?? null,
            agent_id: input.agentId ?? null,
            content: input.content,
            source_type: input.sourceType ?? null,
            importance: input.importance ?? null,
            topic: input.topic ?? null,
            entities: toJSON(input.entities),
            metadata: toJSON(input.metadata),
            created_at: ts,
        }).run();
        return this.getMemory(id)!;
    }

    getMemory(id: MemoryId): MemoryEntry | undefined {
        const row = this.orm.select().from(aiMemoriesTable).where(eq(aiMemoriesTable.id, id)).get() as any;
        return row ? this.mapMemory(row) : undefined;
    }

    listMemories(agentId?: AgentConfigId): MemoryEntry[] {
        if (agentId) {
            return (this.orm
                .select()
                .from(aiMemoriesTable)
                .where(eq(aiMemoriesTable.agent_id, agentId))
                .orderBy(desc(aiMemoriesTable.created_at))
                .all() as any[]).map(r => this.mapMemory(r));
        }
        return (this.orm.select().from(aiMemoriesTable).orderBy(desc(aiMemoriesTable.created_at)).all() as any[]).map(r => this.mapMemory(r));
    }

    searchMemories(query: string): MemoryEntry[] {
        const pattern = `%${query}%`;
        return (this.orm
            .select()
            .from(aiMemoriesTable)
            .where(sql`${aiMemoriesTable.content} LIKE ${pattern}`)
            .orderBy(desc(aiMemoriesTable.created_at))
            .all() as any[]).map(r => this.mapMemory(r));
    }

    deleteMemory(id: MemoryId): void {
        this.orm.delete(aiMemoriesTable).where(eq(aiMemoriesTable.id, id)).run();
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

    // ── Canvases ──────────────────────────────────────────────────────────

    private writeCanvasFiles(canvasId: CanvasId, files: { path: string; content: string }[]) {
        if (!this.canvasesPath) return; 
        const targetDir = path.join(this.canvasesPath, canvasId);
        fs.mkdirSync(targetDir, { recursive: true });
        
        for (const f of files) {
            const fullPath = path.join(targetDir, f.path);
            const dir = path.dirname(fullPath);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(fullPath, f.content, 'utf8');
        }
    }

    private readCanvasFiles(canvasId: CanvasId): { path: string; content: string }[] {
        if (!this.canvasesPath) return [];
        const targetDir = path.join(this.canvasesPath, canvasId);
        if (!fs.existsSync(targetDir)) return [];
        
        const files: { path: string; content: string }[] = [];
        
        const scanDir = (dir: string) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    scanDir(fullPath);
                } else if (entry.isFile()) {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    const relPath = path.relative(targetDir, fullPath);
                    files.push({ path: relPath, content });
                }
            }
        };
        
        scanDir(targetDir);
        return files;
    }

    private generateDiff(oldFiles: { path: string; content: string }[], newFiles: { path: string; content: string }[]): string {
        let diffText = '';
        
        for (const nf of newFiles) {
            const of = oldFiles.find(o => o.path === nf.path);
            if (of) {
                if (of.content !== nf.content) {
                    diffText += diff.createPatch(nf.path, of.content, nf.content) + '\n';
                }
            } else {
                diffText += diff.createPatch(nf.path, '', nf.content) + '\n';
            }
        }
        
        for (const of of oldFiles) {
            if (!newFiles.find(n => n.path === of.path)) {
                diffText += diff.createPatch(of.path, of.content, '') + '\n';
            }
        }
        
        return diffText;
    }

    createCanvas(input: CreateCanvasInput): CanvasConfig {
        const id = (input.id || generateId()) as CanvasId;
        const ts = now();
        
        if (input.files?.length) {
            this.writeCanvasFiles(id, input.files);
        }

        const initialContent = input.content ?? '';
        this.orm.insert(canvasesTable).values({
            id,
            name: input.name,
            description: input.description ?? '',
            content: initialContent,
            metadata: toJSON(input.metadata),
            owner: input.owner,
            created_at: ts,
            updated_at: ts,
        }).run();
        
        const oldFiles: {path: string, content: string}[] = [];
        const diffText = this.generateDiff(oldFiles, input.files || []);
        
        this.createCanvasCommit({
            canvasId: id,
            content: initialContent,
            diff: diffText,
            metadata: input.metadata ?? {},
            changeType: 'created',
            changedBy: input.owner,
            message: input.message ?? 'Initial creation',
        });
        
        return this.getCanvas(id)!;
    }

    getCanvas(id: CanvasId): CanvasConfig | undefined {
        const row = this.orm.select().from(canvasesTable).where(eq(canvasesTable.id, id)).get() as any;
        return row ? this.mapCanvas(row) : undefined;
    }

    listCanvases(owner?: string): CanvasConfig[] {
        const rows = (owner
            ? this.orm.select().from(canvasesTable).where(eq(canvasesTable.owner, owner)).orderBy(desc(canvasesTable.created_at)).all()
            : this.orm.select().from(canvasesTable).orderBy(desc(canvasesTable.created_at)).all()) as any[];
        return rows.map(r => this.mapCanvas(r));
    }

    updateCanvas(id: CanvasId, input: UpdateCanvasInput): CanvasConfig {
        const existing = this.getCanvas(id);
        if (!existing) throw new Error(`Canvas not found: ${id}`);
        
        const oldFiles = this.readCanvasFiles(id);
        if (input.files?.length) {
            this.writeCanvasFiles(id, input.files);
        }
        
        const contentStr = input.content ?? existing.content;

        this.orm.update(canvasesTable).set({
            name: input.name ?? existing.name,
            description: input.description ?? existing.description,
            content: contentStr,
            metadata: toJSON(input.metadata ?? existing.metadata),
            updated_at: now(),
        }).where(eq(canvasesTable.id, id)).run();
        
        const diffText = this.generateDiff(oldFiles, input.files || []);
        
        this.createCanvasCommit({
            canvasId: id,
            content: contentStr,
            diff: diffText,
            metadata: input.metadata ?? existing.metadata,
            changeType: 'updated',
            changedBy: input.changedBy,
            message: input.message ?? 'Updated canvas',
        });
        
        return this.getCanvas(id)!;
    }

    rollbackCanvas(id: CanvasId, commitId: CanvasCommitId, changedBy: string): CanvasConfig {
        const commit = this.getCanvasCommit(commitId);
        if (!commit) throw new Error(`Canvas commit not found: ${commitId}`);
        if (commit.canvasId !== id) throw new Error(`Commit does not belong to canvas: ${id}`);
        
        const existing = this.getCanvas(id);
        if (!existing) throw new Error(`Canvas not found: ${id}`);
        
        this.orm.update(canvasesTable).set({
            name: existing.name,
            description: existing.description,
            content: commit.content,
            metadata: toJSON(commit.metadata),
            updated_at: now(),
        }).where(eq(canvasesTable.id, id)).run();
        
        this.createCanvasCommit({
            canvasId: id,
            content: commit.content,
            diff: commit.diff || '',
            metadata: commit.metadata,
            changeType: 'rollback',
            changedBy,
            message: `Rolled back to ${commitId}`,
        });
        
        return this.getCanvas(id)!;
    }

    deleteCanvas(id: CanvasId): void {
        this.orm.delete(canvasesTable).where(eq(canvasesTable.id, id)).run();
        if (this.canvasesPath) {
            const p = path.join(this.canvasesPath, id);
            if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
        }
    }

    private mapCanvas(row: any): CanvasConfig {
        return {
            id: row.id as CanvasId,
            name: row.name,
            description: row.description,
            content: row.content,
            metadata: fromJSON(row.metadata),
            owner: row.owner,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    // ── Canvas Commits ────────────────────────────────────────────────────

    createCanvasCommit(input: Omit<CanvasCommit, 'id' | 'createdAt'>): CanvasCommit {
        const id = generateId() as CanvasCommitId;
        const ts = now();
        this.orm.insert(canvasCommitsTable).values({
            id,
            canvas_id: input.canvasId,
            content: input.content,
            diff: input.diff ?? '',
            metadata: toJSON(input.metadata),
            change_type: input.changeType,
            changed_by: input.changedBy,
            message: input.message,
            created_at: ts,
        }).run();
        return this.getCanvasCommit(id)!;
    }

    getCanvasCommit(id: CanvasCommitId): CanvasCommit | undefined {
        const row = this.orm.select().from(canvasCommitsTable).where(eq(canvasCommitsTable.id, id)).get() as any;
        return row ? this.mapCanvasCommit(row) : undefined;
    }

    listCanvasCommits(canvasId: CanvasId): CanvasCommit[] {
        const rows = this.orm
            .select()
            .from(canvasCommitsTable)
            .where(eq(canvasCommitsTable.canvas_id, canvasId))
            .orderBy(desc(canvasCommitsTable.created_at))
            .all() as any[];
        return rows.map(r => this.mapCanvasCommit(r));
    }

    private mapCanvasCommit(row: any): CanvasCommit {
        return {
            id: row.id as CanvasCommitId,
            canvasId: row.canvas_id as CanvasId,
            content: row.content,
            diff: row.diff,
            metadata: fromJSON(row.metadata),
            changeType: row.change_type,
            changedBy: row.changed_by,
            message: row.message,
            createdAt: row.created_at,
        };
    }
}
