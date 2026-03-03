/**
 * AI Agent v2 — Drizzle ORM Schema (SQLite).
 *
 * DAG-native: messages and state_nodes use parent_id for graph structure.
 * All tables use the ai_ prefix for namespace isolation.
 */

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
