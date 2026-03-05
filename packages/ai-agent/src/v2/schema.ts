/**
 * AI Agent v2 — Drizzle ORM Schema (SQLite).
 *
 * DAG-native: messages and state_nodes use parent_id for graph structure.
 * All tables use the ai_ prefix for namespace isolation.
 */

import { relations } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ts = () => text('created_at').notNull();
const tsUp = () => text('updated_at').notNull();

// ─── Providers ───────────────────────────────────────────────────────────────

export const aiProvidersTable = sqliteTable('ai_providers', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	type: text('type').notNull(),
	adapter: text('adapter'),
	auth_type: text('auth_type'),
	base_url: text('base_url'),
	api_key_ref: text('api_key_ref'),
	headers: text('headers').notNull().default('{}'),
	timeout_ms: integer('timeout_ms'),
	metadata: text('metadata').notNull().default('{}'),
	created_at: ts(),
	updated_at: tsUp(),
});

// ─── Models ──────────────────────────────────────────────────────────────────

export const aiModelsTable = sqliteTable('ai_models', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	provider_id: text('provider_id').notNull(),
	model_id: text('model_id').notNull(),
	runtime: text('runtime'),
	supports_tools: integer('supports_tools'),
	supports_streaming: integer('supports_streaming'),
	params: text('params').notNull().default('{}'),
	created_at: ts(),
	updated_at: tsUp(),
});

// ─── Tools ───────────────────────────────────────────────────────────────────

export const aiToolsTable = sqliteTable('ai_tools', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	description: text('description').notNull().default(''),
	parameters_schema: text('parameters_schema').notNull().default('{}'),
	handler_type: text('handler_type').notNull(),
	handler_config: text('handler_config').notNull().default('{}'),
	created_at: ts(),
	updated_at: tsUp(),
});

// ─── MCP Servers ─────────────────────────────────────────────────────────────

export const aiMcpServersTable = sqliteTable('ai_mcp_servers', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	protocol_version: text('protocol_version'),
	capabilities: text('capabilities').notNull().default('[]'),
	transport: text('transport').notNull(),
	handler_config: text('handler_config').notNull().default('{}'),
	created_at: ts(),
	updated_at: tsUp(),
});

// ─── Agents ──────────────────────────────────────────────────────────────────

export const aiAgentsTable = sqliteTable('ai_agents', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	description: text('description').notNull().default(''),
	model_id: text('model_id').notNull(),
	system_prompt: text('system_prompt').notNull().default(''),
	tool_ids: text('tool_ids').notNull().default('[]'),
	params: text('params').notNull().default('{}'),
	created_at: ts(),
	updated_at: tsUp(),
});

export const aiAgentToolsTable = sqliteTable('ai_agent_tools', {
	agent_id: text('agent_id').notNull(),
	tool_id: text('tool_id').notNull(),
	sort_order: integer('sort_order').notNull().default(0),
});

export const aiAgentMcpServersTable = sqliteTable('ai_agent_mcp_servers', {
	agent_id: text('agent_id').notNull(),
	server_id: text('server_id').notNull(),
	sort_order: integer('sort_order').notNull().default(0),
});

// ─── Workflows ───────────────────────────────────────────────────────────────

export const aiWorkflowsTable = sqliteTable('ai_workflows', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	description: text('description').notNull().default(''),
	type: text('type').notNull(),
	nodes: text('nodes').notNull().default('[]'),
	edges: text('edges').notNull().default('[]'),
	created_at: ts(),
	updated_at: tsUp(),
});

export const aiWorkflowVersionsTable = sqliteTable('ai_workflow_versions', {
	id: text('id').primaryKey(),
	workflow_id: text('workflow_id').notNull(),
	version: integer('version').notNull(),
	nodes: text('nodes').notNull().default('[]'),
	edges: text('edges').notNull().default('[]'),
	status: text('status').notNull().default('active'),
	activated_at: text('activated_at').notNull(),
	deactivated_at: text('deactivated_at'),
	created_at: ts(),
});

// ─── Sessions (v2) ──────────────────────────────────────────────────────────

export const aiSessionsTable = sqliteTable('ai_sessions', {
	id: text('id').primaryKey(),
	agent_id: text('agent_id'),
	workflow_id: text('workflow_id'),
	model_id: text('model_id'),
	provider_id: text('provider_id'),
	mode: text('mode'),
	title: text('title').notNull().default('New Chat'),
	head_message_id: text('head_message_id'),
	created_at: ts(),
	updated_at: tsUp(),
});

export const aiSessionToolsTable = sqliteTable('ai_session_tools', {
	session_id: text('session_id').notNull(),
	tool_id: text('tool_id').notNull(),
	sort_order: integer('sort_order').notNull().default(0),
});

export const aiSessionMcpServersTable = sqliteTable('ai_session_mcp_servers', {
	session_id: text('session_id').notNull(),
	server_id: text('server_id').notNull(),
	sort_order: integer('sort_order').notNull().default(0),
});

// ─── Messages (v2 — DAG) ────────────────────────────────────────────────────

export const aiMessagesTable = sqliteTable('ai_messages', {
	id: text('id').primaryKey(),
	session_id: text('session_id').notNull(),
	parent_id: text('parent_id'),
	branch: text('branch').notNull().default('main'),
	role: text('role').notNull(),
	content: text('content').notNull().default(''),
	tool_calls: text('tool_calls').notNull().default('[]'),
	tool_results: text('tool_results').notNull().default('[]'),
	provider_type: text('provider_type'),
	model_id: text('model_id'),
	finish_reason: text('finish_reason'),
	usage: text('usage'),
	latency_ms: integer('latency_ms'),
	metadata: text('metadata'),
	created_at: ts(),
});

// ─── State Nodes (v2 — execution DAG) ───────────────────────────────────────

export const aiStateNodesTable = sqliteTable('ai_state_nodes', {
	id: text('id').primaryKey(),
	execution_id: text('execution_id').notNull(),
	parent_id: text('parent_id'),
	kind: text('kind').notNull(),
	status: text('status').notNull().default('running'),
	payload: text('payload').notNull().default('{}'),
	checkpoint: text('checkpoint'),
	note: text('note'),
	started_at: text('started_at').notNull(),
	completed_at: text('completed_at'),
});

// ─── Executions ──────────────────────────────────────────────────────────────

export const aiExecutionsTable = sqliteTable('ai_executions', {
	id: text('id').primaryKey(),
	type: text('type').notNull(),
	session_id: text('session_id'),
	workflow_id: text('workflow_id'),
	agent_id: text('agent_id'),
	status: text('status').notNull().default('running'),
	input: text('input').notNull(),
	final_output: text('final_output'),
	last_checkpoint_id: text('last_checkpoint_id'),
	worker_run_id: text('worker_run_id'),
	started_at: text('started_at').notNull(),
	completed_at: text('completed_at'),
});

// ─── Worker Runs ─────────────────────────────────────────────────────────────

export const aiWorkerRunsTable = sqliteTable('ai_worker_runs', {
	id: text('id').primaryKey(),
	execution_id: text('execution_id').notNull(),
	thread_id: integer('thread_id'),
	status: text('status').notNull().default('starting'),
	error: text('error'),
	started_at: text('started_at').notNull(),
	completed_at: text('completed_at'),
});

// ─── HITL Waits ──────────────────────────────────────────────────────────────

export const aiHitlWaitsTable = sqliteTable('ai_hitl_waits', {
	id: text('id').primaryKey(),
	execution_id: text('execution_id').notNull(),
	state_node_id: text('state_node_id').notNull(),
	status: text('status').notNull().default('pending'),
	tool_context: text('tool_context').notNull().default('{}'),
	runtime_snapshot: text('runtime_snapshot').notNull().default('{}'),
	operator_instructions: text('operator_instructions').notNull().default(''),
	user_response: text('user_response'),
	created_at: ts(),
	resolved_at: text('resolved_at'),
});

// ─── Audit Events ────────────────────────────────────────────────────────────

export const aiAuditEventsTable = sqliteTable('ai_audit_events', {
	id: text('id').primaryKey(),
	execution_id: text('execution_id'),
	kind: text('kind').notNull(),
	payload: text('payload').notNull().default('{}'),
	created_at: ts(),
});

// ─── Tool Calls ──────────────────────────────────────────────────────────────

export const aiToolCallsTable = sqliteTable('ai_tool_calls', {
	id: text('id').primaryKey(),
	session_id: text('session_id').notNull(),
	message_id: text('message_id').notNull(),
	tool_name: text('tool_name').notNull(),
	arguments: text('arguments').notNull(),
	result: text('result'),
	latency_ms: integer('latency_ms'),
	created_at: ts(),
});

// ─── Memories ────────────────────────────────────────────────────────────────

export const aiMemoriesTable = sqliteTable('ai_memories', {
	id: text('id').primaryKey(),
	session_id: text('session_id'),
	agent_id: text('agent_id'),
	content: text('content').notNull(),
	source_type: text('source_type'),
	importance: integer('importance'),
	topic: text('topic'),
	entities: text('entities'),
	metadata: text('metadata').notNull().default('{}'),
	created_at: ts(),
});

// ─── Canvases ────────────────────────────────────────────────────────────────

export const canvasesTable = sqliteTable('canvases', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	description: text('description').notNull().default(''),
	content: text('content').notNull().default(''),
	metadata: text('metadata').notNull().default('{}'),
	owner: text('owner').notNull(),
	created_at: ts(),
	updated_at: tsUp(),
});

export const canvasCommitsTable = sqliteTable('canvas_commits', {
	id: text('id').primaryKey(),
	canvas_id: text('canvas_id').notNull(),
	content: text('content').notNull(),
	diff: text('diff').notNull().default(''),
	metadata: text('metadata').notNull().default('{}'),
	change_type: text('change_type').notNull(),
	changed_by: text('changed_by').notNull(),
	message: text('message').notNull(),
	created_at: ts(),
});

// ─── Relations ───────────────────────────────────────────────────────────────

export const aiModelsRelations = relations(aiModelsTable, ({ one }) => ({
	provider: one(aiProvidersTable, {
		fields: [aiModelsTable.provider_id],
		references: [aiProvidersTable.id],
	}),
}));

export const aiAgentToolsRelations = relations(aiAgentToolsTable, ({ one }) => ({
	agent: one(aiAgentsTable, {
		fields: [aiAgentToolsTable.agent_id],
		references: [aiAgentsTable.id],
	}),
	tool: one(aiToolsTable, {
		fields: [aiAgentToolsTable.tool_id],
		references: [aiToolsTable.id],
	}),
}));

export const aiAgentMcpServersRelations = relations(aiAgentMcpServersTable, ({ one }) => ({
	agent: one(aiAgentsTable, {
		fields: [aiAgentMcpServersTable.agent_id],
		references: [aiAgentsTable.id],
	}),
	server: one(aiMcpServersTable, {
		fields: [aiAgentMcpServersTable.server_id],
		references: [aiMcpServersTable.id],
	}),
}));

export const aiAgentsRelations = relations(aiAgentsTable, ({ one, many }) => ({
	model: one(aiModelsTable, {
		fields: [aiAgentsTable.model_id],
		references: [aiModelsTable.id],
	}),
	agentTools: many(aiAgentToolsTable),
	agentMcpServers: many(aiAgentMcpServersTable),
}));

export const aiWorkflowVersionsRelations = relations(aiWorkflowVersionsTable, ({ one }) => ({
	workflow: one(aiWorkflowsTable, {
		fields: [aiWorkflowVersionsTable.workflow_id],
		references: [aiWorkflowsTable.id],
	}),
}));

export const aiWorkflowsRelations = relations(aiWorkflowsTable, ({ many }) => ({
	versions: many(aiWorkflowVersionsTable),
}));

export const aiSessionToolsRelations = relations(aiSessionToolsTable, ({ one }) => ({
	session: one(aiSessionsTable, {
		fields: [aiSessionToolsTable.session_id],
		references: [aiSessionsTable.id],
	}),
	tool: one(aiToolsTable, {
		fields: [aiSessionToolsTable.tool_id],
		references: [aiToolsTable.id],
	}),
}));

export const aiSessionMcpServersRelations = relations(aiSessionMcpServersTable, ({ one }) => ({
	session: one(aiSessionsTable, {
		fields: [aiSessionMcpServersTable.session_id],
		references: [aiSessionsTable.id],
	}),
	server: one(aiMcpServersTable, {
		fields: [aiSessionMcpServersTable.server_id],
		references: [aiMcpServersTable.id],
	}),
}));

export const aiSessionsRelations = relations(aiSessionsTable, ({ one, many }) => ({
	agent: one(aiAgentsTable, {
		fields: [aiSessionsTable.agent_id],
		references: [aiAgentsTable.id],
	}),
	workflow: one(aiWorkflowsTable, {
		fields: [aiSessionsTable.workflow_id],
		references: [aiWorkflowsTable.id],
	}),
	model: one(aiModelsTable, {
		fields: [aiSessionsTable.model_id],
		references: [aiModelsTable.id],
	}),
	provider: one(aiProvidersTable, {
		fields: [aiSessionsTable.provider_id],
		references: [aiProvidersTable.id],
	}),
	sessionTools: many(aiSessionToolsTable),
	sessionMcpServers: many(aiSessionMcpServersTable),
	messages: many(aiMessagesTable),
	executions: many(aiExecutionsTable),
	memories: many(aiMemoriesTable),
}));

export const aiMessagesRelations = relations(aiMessagesTable, ({ one }) => ({
	session: one(aiSessionsTable, {
		fields: [aiMessagesTable.session_id],
		references: [aiSessionsTable.id],
	}),
}));

export const aiStateNodesRelations = relations(aiStateNodesTable, ({ one }) => ({
	execution: one(aiExecutionsTable, {
		fields: [aiStateNodesTable.execution_id],
		references: [aiExecutionsTable.id],
	}),
}));

export const aiExecutionsRelations = relations(aiExecutionsTable, ({ one, many }) => ({
	session: one(aiSessionsTable, {
		fields: [aiExecutionsTable.session_id],
		references: [aiSessionsTable.id],
	}),
	workflow: one(aiWorkflowsTable, {
		fields: [aiExecutionsTable.workflow_id],
		references: [aiWorkflowsTable.id],
	}),
	agent: one(aiAgentsTable, {
		fields: [aiExecutionsTable.agent_id],
		references: [aiAgentsTable.id],
	}),
	stateNodes: many(aiStateNodesTable),
	auditEvents: many(aiAuditEventsTable),
	hitlWaits: many(aiHitlWaitsTable),
	workerRuns: many(aiWorkerRunsTable),
}));

export const aiWorkerRunsRelations = relations(aiWorkerRunsTable, ({ one }) => ({
	execution: one(aiExecutionsTable, {
		fields: [aiWorkerRunsTable.execution_id],
		references: [aiExecutionsTable.id],
	}),
}));

export const aiHitlWaitsRelations = relations(aiHitlWaitsTable, ({ one }) => ({
	execution: one(aiExecutionsTable, {
		fields: [aiHitlWaitsTable.execution_id],
		references: [aiExecutionsTable.id],
	}),
	stateNode: one(aiStateNodesTable, {
		fields: [aiHitlWaitsTable.state_node_id],
		references: [aiStateNodesTable.id],
	}),
}));

export const aiAuditEventsRelations = relations(aiAuditEventsTable, ({ one }) => ({
	execution: one(aiExecutionsTable, {
		fields: [aiAuditEventsTable.execution_id],
		references: [aiExecutionsTable.id],
	}),
}));

export const aiMemoriesRelations = relations(aiMemoriesTable, ({ one }) => ({
	session: one(aiSessionsTable, {
		fields: [aiMemoriesTable.session_id],
		references: [aiSessionsTable.id],
	}),
	agent: one(aiAgentsTable, {
		fields: [aiMemoriesTable.agent_id],
		references: [aiAgentsTable.id],
	}),
}));

export const canvasesRelations = relations(canvasesTable, ({ many }) => ({
	commits: many(canvasCommitsTable),
}));

export const canvasCommitsRelations = relations(canvasCommitsTable, ({ one }) => ({
	canvas: one(canvasesTable, {
		fields: [canvasCommitsTable.canvas_id],
		references: [canvasesTable.id],
	}),
}));

export const aiAgentV2Schema = {
	aiProvidersTable,
	aiModelsTable,
	aiToolsTable,
	aiMcpServersTable,
	aiAgentsTable,
	aiAgentToolsTable,
	aiAgentMcpServersTable,
	aiWorkflowsTable,
	aiWorkflowVersionsTable,
	aiSessionsTable,
	aiSessionToolsTable,
	aiSessionMcpServersTable,
	aiMessagesTable,
	aiStateNodesTable,
	aiExecutionsTable,
	aiWorkerRunsTable,
	aiHitlWaitsTable,
	aiAuditEventsTable,
	aiToolCallsTable,
	aiMemoriesTable,
	canvasesTable,
	canvasCommitsTable,
	aiModelsRelations,
	aiAgentToolsRelations,
	aiAgentMcpServersRelations,
	aiAgentsRelations,
	aiWorkflowVersionsRelations,
	aiWorkflowsRelations,
	aiSessionToolsRelations,
	aiSessionMcpServersRelations,
	aiSessionsRelations,
	aiMessagesRelations,
	aiStateNodesRelations,
	aiExecutionsRelations,
	aiWorkerRunsRelations,
	aiHitlWaitsRelations,
	aiAuditEventsRelations,
	aiMemoriesRelations,
	canvasesRelations,
	canvasCommitsRelations,
} as const;
