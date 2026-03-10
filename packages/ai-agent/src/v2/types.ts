/**
 * AI Agent v2 — Domain Types.
 *
 * DAG-native state model with branching, rewind, and durable execution.
 * Uses branded IDs matching the @orch/shared convention.
 */

// ─── Branded IDs ─────────────────────────────────────────────────────────────

type Brand<T, B extends string> = T & { readonly __brand: B };

export type ProviderId = Brand<string, 'ProviderId'>;
export type ModelId = Brand<string, 'ModelId'>;
export type ToolConfigId = Brand<string, 'ToolConfigId'>;
export type AgentConfigId = Brand<string, 'AgentConfigId'>;
export type WorkflowId = Brand<string, 'WorkflowId'>;
export type WorkflowVersionId = Brand<string, 'WorkflowVersionId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type StateNodeId = Brand<string, 'StateNodeId'>;
export type ExecutionId = Brand<string, 'ExecutionId'>;
export type McpServerId = Brand<string, 'McpServerId'>;
export type MemoryId = Brand<string, 'MemoryId'>;
export type HitlWaitId = Brand<string, 'HitlWaitId'>;
export type WorkerRunId = Brand<string, 'WorkerRunId'>;
export type AuditEventId = Brand<string, 'AuditEventId'>;
export type CanvasId = Brand<string, 'CanvasId'>;
export type CanvasCommitId = Brand<string, 'CanvasCommitId'>;

export function generateId(): string {
	return crypto.randomUUID();
}

// ─── Provider ────────────────────────────────────────────────────────────────

export type ProviderType = 'openai' | 'anthropic' | 'ollama' | 'google' | 'groq' | 'custom';
export type ProviderAdapter = 'adk-native' | 'anthropic' | 'ollama';
export type ProviderAuthType = 'none' | 'api-key' | 'bearer';

export interface ProviderConfig {
	id: ProviderId;
	name: string;
	type: ProviderType;
	adapter?: ProviderAdapter;
	authType?: ProviderAuthType;
	baseUrl?: string;
	apiKeyRef?: string;
	headers?: Record<string, string>;
	timeoutMs?: number;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CreateProviderInput {
	name: string;
	type: ProviderType;
	adapter?: ProviderAdapter;
	authType?: ProviderAuthType;
	baseUrl?: string;
	apiKeyRef?: string;
	headers?: Record<string, string>;
	timeoutMs?: number;
	metadata?: Record<string, unknown>;
}

// ─── Model ───────────────────────────────────────────────────────────────────

export interface ModelParams {
	temperature?: number;
	maxTokens?: number;
	topP?: number;
	topK?: number;
	frequencyPenalty?: number;
	presencePenalty?: number;
	stop?: string[];
	[key: string]: unknown;
}

export interface ModelConfig {
	id: ModelId;
	name: string;
	providerId: ProviderId;
	modelId: string;
	runtime?: 'chat' | 'agent' | 'workflow';
	supportsTools?: boolean;
	supportsStreaming?: boolean;
	params: ModelParams;
	createdAt: string;
	updatedAt: string;
}

export interface CreateModelInput {
	name: string;
	providerId: ProviderId;
	modelId: string;
	runtime?: 'chat' | 'agent' | 'workflow';
	supportsTools?: boolean;
	supportsStreaming?: boolean;
	params?: ModelParams;
}

// ─── Tool ────────────────────────────────────────────────────────────────────

export type ToolHandlerType = 'builtin' | 'script' | 'api';

export interface ToolConfig {
	id: ToolConfigId;
	name: string;
	description: string;
	parametersSchema: Record<string, unknown>;
	handlerType: ToolHandlerType;
	handlerConfig: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CreateToolInput {
	name: string;
	description: string;
	parametersSchema: Record<string, unknown>;
	handlerType: ToolHandlerType;
	handlerConfig: Record<string, unknown>;
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

export type McpTransportType = 'stdio' | 'sse' | 'custom';

export interface McpServerConfig {
	id: McpServerId;
	name: string;
	protocolVersion?: string;
	capabilities: string[];
	transport: McpTransportType;
	handlerConfig: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CreateMcpServerInput {
	name: string;
	protocolVersion?: string;
	capabilities?: string[];
	transport: McpTransportType;
	handlerConfig: Record<string, unknown>;
}

// ─── Agent ───────────────────────────────────────────────────────────────────

export interface AgentConfig {
	id: AgentConfigId;
	name: string;
	description: string;
	modelId: ModelId;
	systemPrompt: string;
	toolIds: ToolConfigId[];
	mcpServerIds?: McpServerId[];
	params?: ModelParams;
	createdAt: string;
	updatedAt: string;
}

export interface CreateAgentInput {
	name: string;
	description?: string;
	modelId: ModelId;
	systemPrompt?: string;
	toolIds?: ToolConfigId[];
	mcpServerIds?: McpServerId[];
	params?: ModelParams;
}

// ─── Workflow ────────────────────────────────────────────────────────────────

export type WorkflowType = 'sequential' | 'parallel' | 'loop';

export interface WorkflowNode {
	id: string;
	type: 'agent' | 'tool' | 'condition' | 'input' | 'output' | 'loop' | 'hitl';
	position: { x: number; y: number };
	data: Record<string, any>;
}

export interface WorkflowEdge {
	id: string;
	source: string;
	target: string;
	sourceHandle?: string;
	targetHandle?: string;
	label?: string;
}

export interface WorkflowConfig {
	id: WorkflowId;
	name: string;
	description: string;
	type: WorkflowType;
	nodes: WorkflowNode[];
	edges: WorkflowEdge[];
	createdAt: string;
	updatedAt: string;
}

export interface CreateWorkflowInput {
	name: string;
	description?: string;
	type: WorkflowType;
	nodes: WorkflowNode[];
	edges: WorkflowEdge[];
}

export interface WorkflowVersion {
	id: WorkflowVersionId;
	workflowId: WorkflowId;
	version: number;
	nodes: WorkflowNode[];
	edges: WorkflowEdge[];
	status: 'active' | 'archived';
	activatedAt: string;
	deactivatedAt?: string;
	createdAt: string;
}

// ─── Session (v2 — DAG-aware) ────────────────────────────────────────────────

export interface Session {
	id: SessionId;
	agentId?: AgentConfigId;
	workflowId?: WorkflowId;
	modelId?: ModelId;
	providerId?: ProviderId;
	mode?: 'chat' | 'agent' | 'workflow';
	title: string;
	toolIds: ToolConfigId[];
	mcpServerIds?: McpServerId[];
	/** The ID of the current head message in this session's DAG branch. */
	headMessageId?: MessageId;
	createdAt: string;
	updatedAt: string;
}

export interface CreateSessionInput {
	agentId?: AgentConfigId;
	workflowId?: WorkflowId;
	modelId?: ModelId;
	providerId?: ProviderId;
	mode?: 'chat' | 'agent' | 'workflow';
	title?: string;
	toolIds?: ToolConfigId[];
	mcpServerIds?: McpServerId[];
}

// ─── Message (v2 — DAG node) ─────────────────────────────────────────────────

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
	id: MessageId;
	sessionId: SessionId;
	/** Parent message in the DAG. null = root of a conversation tree. */
	parentId: MessageId | null;
	/** Branch label for UI grouping (e.g. "main", "retry-1"). */
	branch: string;
	role: MessageRole;
	content: string;
	toolCalls?: any[];
	toolResults?: any[];
	providerType?: ProviderType;
	modelId?: string;
	finishReason?: string;
	usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
	latencyMs?: number;
	metadata?: Record<string, unknown>;
	createdAt: string;
}

export interface CreateMessageInput {
	sessionId: SessionId;
	parentId?: MessageId | null;
	branch?: string;
	role: MessageRole;
	content: string;
	toolCalls?: any[];
	toolResults?: any[];
	providerType?: ProviderType;
	modelId?: string;
	finishReason?: string;
	usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
	latencyMs?: number;
	metadata?: Record<string, unknown>;
}

// ─── State Node (v2 — DAG execution checkpoint) ──────────────────────────────

export type StateNodeStatus = 'running' | 'completed' | 'failed' | 'waiting_for_input' | 'cancelled';
export type StateNodeKind = 'llm_call' | 'tool_call' | 'tool_response' | 'reasoning' | 'conditional' | 'loop_iteration' | 'hitl_pause' | 'workflow_start' | 'workflow_end' | 'agent_start' | 'agent_end' | 'react_start' | 'react_end';

export interface StateNode {
	id: StateNodeId;
	executionId: ExecutionId;
	/** Parent node in the DAG. null = root. */
	parentId: StateNodeId | null;
	kind: StateNodeKind;
	status: StateNodeStatus;
	/** Serialized step payload (tool args, LLM response chunk, etc.). */
	payload: Record<string, unknown>;
	/** Serialized ADK runtime snapshot for crash recovery. */
	checkpoint?: Record<string, unknown>;
	/** Human-readable note for audit/debugging. */
	note?: string;
	startedAt: string;
	completedAt?: string;
}

export interface CreateStateNodeInput {
	executionId: ExecutionId;
	parentId?: StateNodeId | null;
	kind: StateNodeKind;
	status?: StateNodeStatus;
	payload?: Record<string, unknown>;
	checkpoint?: Record<string, unknown>;
	note?: string;
}

// ─── Execution ───────────────────────────────────────────────────────────────

export type ExecutionType = 'chat' | 'workflow';
export type ExecutionStatus = 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';

export interface Execution {
	id: ExecutionId;
	type: ExecutionType;
	sessionId?: SessionId;
	workflowId?: WorkflowId;
	agentId?: AgentConfigId;
	status: ExecutionStatus;
	input: string;
	finalOutput?: string;
	/** Last successful state node (for resume). */
	lastCheckpointId?: StateNodeId;
	workerRunId?: WorkerRunId;
	startedAt: string;
	completedAt?: string;
}

export interface CreateExecutionInput {
	type: ExecutionType;
	sessionId?: SessionId;
	workflowId?: WorkflowId;
	agentId?: AgentConfigId;
	input: string;
}

// ─── Worker Run ──────────────────────────────────────────────────────────────

export type WorkerRunStatus = 'starting' | 'running' | 'completed' | 'failed' | 'terminated';

export interface WorkerRun {
	id: WorkerRunId;
	executionId: ExecutionId;
	threadId?: number;
	status: WorkerRunStatus;
	error?: string;
	startedAt: string;
	completedAt?: string;
}

export interface CreateWorkerRunInput {
	executionId: ExecutionId;
	threadId?: number;
}

// ─── HITL Wait ───────────────────────────────────────────────────────────────

export type HitlWaitStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface HitlWait {
	id: HitlWaitId;
	executionId: ExecutionId;
	stateNodeId: StateNodeId;
	status: HitlWaitStatus;
	/** What the model is requesting approval for. */
	toolContext: Record<string, unknown>;
	/** Serialized runtime for full rehydration. */
	runtimeSnapshot: Record<string, unknown>;
	/** Instructions for the human operator. */
	operatorInstructions: string;
	/** User's response (approval payload, rejection reason, etc.). */
	userResponse?: Record<string, unknown>;
	createdAt: string;
	resolvedAt?: string;
}

export interface CreateHitlWaitInput {
	executionId: ExecutionId;
	stateNodeId: StateNodeId;
	toolContext: Record<string, unknown>;
	runtimeSnapshot: Record<string, unknown>;
	operatorInstructions: string;
}

// ─── Audit Event ─────────────────────────────────────────────────────────────

export type AuditEventKind = 'execution.start' | 'execution.complete' | 'execution.fail' | 'execution.pause' | 'execution.resume' | 'worker.start' | 'worker.crash' | 'worker.resume' | 'hitl.request' | 'hitl.resolve' | 'state.checkpoint' | 'state.branch';

export interface AuditEvent {
	id: AuditEventId;
	executionId?: ExecutionId;
	kind: AuditEventKind;
	payload: Record<string, unknown>;
	createdAt: string;
}

export interface CreateAuditEventInput {
	executionId?: ExecutionId;
	kind: AuditEventKind;
	payload?: Record<string, unknown>;
}

// ─── Memory ──────────────────────────────────────────────────────────────────

export interface MemoryEntry {
	id: MemoryId;
	sessionId?: SessionId;
	agentId?: AgentConfigId;
	content: string;
	sourceType?: 'chat' | 'tool' | 'document' | 'system';
	importance?: number;
	topic?: string;
	entities?: string[];
	metadata?: Record<string, unknown>;
	createdAt: string;
}

export interface CreateMemoryInput {
	sessionId?: SessionId;
	agentId?: AgentConfigId;
	content: string;
	sourceType?: 'chat' | 'tool' | 'document' | 'system';
	importance?: number;
	topic?: string;
	entities?: string[];
	metadata?: Record<string, unknown>;
}

// ─── Canvas (unchanged) ─────────────────────────────────────────────────────

export interface CanvasConfig {
	id: CanvasId;
	name: string;
	description: string;
	content: string;
	metadata: Record<string, unknown>;
	owner: string;
	createdAt: string;
	updatedAt: string;
}

export interface CanvasCommit {
	id: CanvasCommitId;
	canvasId: CanvasId;
	content: string;
	diff: string;
	metadata: Record<string, unknown>;
	changeType: 'created' | 'updated' | 'rollback';
	changedBy: string;
	message: string;
	createdAt: string;
}

export interface CreateCanvasInput {
	id?: string;
	name: string;
	description?: string;
	content?: string;
	files?: { path: string; content: string }[];
	metadata?: Record<string, unknown>;
	owner: string;
	message?: string;
}

export interface UpdateCanvasInput {
	name?: string;
	description?: string;
	content?: string;
	files?: { path: string; content: string }[];
	metadata?: Record<string, unknown>;
	changedBy: string;
	message?: string;
}

// ─── Resolved Model (from ProviderManager) ───────────────────────────────────

export interface ResolvedModel {
	adapter: ProviderAdapter;
	modelString?: string;
	provider: ProviderConfig;
	model: ModelConfig;
	params: ModelParams;
	apiKey?: string;
	endpoint?: string;
	headers: Record<string, string>;
	timeoutMs: number;
}
