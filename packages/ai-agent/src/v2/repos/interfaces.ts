/**
 * AI Agent v2 — Repository Interfaces.
 *
 * These are the ONLY data-access contracts the orchestration layer may use.
 * Concrete implementations use Drizzle ORM + encrypted SQLite under the hood,
 * but that detail is invisible to consumers.
 */

import type {
	// IDs
	ProviderId, ModelId, ToolConfigId, AgentConfigId, WorkflowId,
	SessionId, MessageId, StateNodeId,
	ExecutionId, McpServerId, MemoryId, HitlWaitId, WorkerRunId,
	// Domain types
	ProviderConfig, CreateProviderInput,
	ModelConfig, CreateModelInput,
	ToolConfig, CreateToolInput,
	McpServerConfig, CreateMcpServerInput,
	AgentConfig, CreateAgentInput,
	WorkflowConfig, CreateWorkflowInput, WorkflowVersion,
	Session, CreateSessionInput,
	Message, CreateMessageInput,
	StateNode, CreateStateNodeInput, StateNodeStatus,
	Execution, CreateExecutionInput, ExecutionStatus,
	WorkerRun, CreateWorkerRunInput, WorkerRunStatus,
	HitlWait, CreateHitlWaitInput, HitlWaitStatus,
	AuditEvent, CreateAuditEventInput,
	MemoryEntry, CreateMemoryInput,
} from '../types.js';

// ─── Provider Repo ───────────────────────────────────────────────────────────

export interface IProviderRepo {
	create(input: CreateProviderInput): ProviderConfig;
	get(id: ProviderId): ProviderConfig | undefined;
	list(): ProviderConfig[];
	update(id: ProviderId, input: Partial<CreateProviderInput>): ProviderConfig;
	delete(id: ProviderId): void;
}

// ─── Model Repo ──────────────────────────────────────────────────────────────

export interface IModelRepo {
	create(input: CreateModelInput): ModelConfig;
	get(id: ModelId): ModelConfig | undefined;
	list(): ModelConfig[];
	update(id: ModelId, input: Partial<CreateModelInput>): ModelConfig;
	delete(id: ModelId): void;
}

// ─── Tool Repo ───────────────────────────────────────────────────────────────

export interface IToolRepo {
	create(input: CreateToolInput): ToolConfig;
	get(id: ToolConfigId): ToolConfig | undefined;
	list(): ToolConfig[];
	update(id: ToolConfigId, input: Partial<CreateToolInput>): ToolConfig;
	delete(id: ToolConfigId): void;
}

// ─── MCP Server Repo ─────────────────────────────────────────────────────────

export interface IMcpServerRepo {
	create(input: CreateMcpServerInput): McpServerConfig;
	get(id: McpServerId): McpServerConfig | undefined;
	list(): McpServerConfig[];
	update(id: McpServerId, input: Partial<CreateMcpServerInput>): McpServerConfig;
	delete(id: McpServerId): void;
}

// ─── Agent Repo ──────────────────────────────────────────────────────────────

export interface IAgentRepo {
	create(input: CreateAgentInput): AgentConfig;
	get(id: AgentConfigId): AgentConfig | undefined;
	list(): AgentConfig[];
	update(id: AgentConfigId, input: Partial<CreateAgentInput>): AgentConfig;
	delete(id: AgentConfigId): void;
	setTools(agentId: AgentConfigId, toolIds: ToolConfigId[]): void;
	getTools(agentId: AgentConfigId): ToolConfig[];
	setMcpServers(agentId: AgentConfigId, serverIds: McpServerId[]): void;
	getMcpServers(agentId: AgentConfigId): McpServerConfig[];
}

// ─── Workflow Repo ───────────────────────────────────────────────────────────

export interface IWorkflowRepo {
	create(input: CreateWorkflowInput): WorkflowConfig;
	get(id: WorkflowId): WorkflowConfig | undefined;
	list(): WorkflowConfig[];
	update(id: WorkflowId, input: Partial<CreateWorkflowInput>): WorkflowConfig;
	delete(id: WorkflowId): void;
	createVersion(workflowId: WorkflowId): WorkflowVersion;
	getActiveVersion(workflowId: WorkflowId): WorkflowVersion | undefined;
	listVersions(workflowId: WorkflowId): WorkflowVersion[];
}

// ─── Session Repo ────────────────────────────────────────────────────────────

export interface ISessionRepo {
	create(input: CreateSessionInput): Session;
	get(id: SessionId): Session | undefined;
	list(): Session[];
	update(id: SessionId, input: Partial<CreateSessionInput>): Session;
	delete(id: SessionId): void;
	setHeadMessage(sessionId: SessionId, messageId: MessageId): void;
	setTools(sessionId: SessionId, toolIds: ToolConfigId[]): void;
	getTools(sessionId: SessionId): ToolConfig[];
	setMcpServers(sessionId: SessionId, serverIds: McpServerId[]): void;
	getMcpServers(sessionId: SessionId): McpServerConfig[];
}

// ─── Message Repo (DAG) ─────────────────────────────────────────────────────

export interface IMessageRepo {
	create(input: CreateMessageInput): Message;
	get(id: MessageId): Message | undefined;
	/** List messages in a session, ordered by creation time. */
	listBySession(sessionId: SessionId): Message[];
	/** Walk the DAG from a given node up to the root, returning ancestor chain. */
	getAncestry(messageId: MessageId): Message[];
	/** Get direct children of a message (branches). */
	getChildren(parentId: MessageId): Message[];
	/** Get the linear chain from root to a specific leaf (for prompt assembly). */
	getLinearChain(leafId: MessageId): Message[];
	/** List distinct branch labels for a session. */
	listBranches(sessionId: SessionId): string[];
}

// ─── State Node Repo (DAG) ──────────────────────────────────────────────────

export interface IStateNodeRepo {
	create(input: CreateStateNodeInput): StateNode;
	get(id: StateNodeId): StateNode | undefined;
	listByExecution(executionId: ExecutionId): StateNode[];
	updateStatus(id: StateNodeId, status: StateNodeStatus, completedAt?: string): void;
	updateCheckpoint(id: StateNodeId, checkpoint: Record<string, unknown>): void;
	getAncestry(nodeId: StateNodeId): StateNode[];
	getChildren(parentId: StateNodeId): StateNode[];
	/** Find the last completed node for an execution (for crash recovery). */
	getLastCompleted(executionId: ExecutionId): StateNode | undefined;
}

// ─── Execution Repo ──────────────────────────────────────────────────────────

export interface IExecutionRepo {
	create(input: CreateExecutionInput): Execution;
	get(id: ExecutionId): Execution | undefined;
	listBySession(sessionId: SessionId): Execution[];
	listByWorkflow(workflowId: WorkflowId): Execution[];
	updateStatus(id: ExecutionId, status: ExecutionStatus, finalOutput?: string): void;
	setLastCheckpoint(id: ExecutionId, stateNodeId: StateNodeId): void;
	setWorkerRun(id: ExecutionId, workerRunId: WorkerRunId): void;
}

// ─── Worker Run Repo ─────────────────────────────────────────────────────────

export interface IWorkerRunRepo {
	create(input: CreateWorkerRunInput): WorkerRun;
	get(id: WorkerRunId): WorkerRun | undefined;
	updateStatus(id: WorkerRunId, status: WorkerRunStatus, error?: string): void;
}

// ─── HITL Wait Repo ──────────────────────────────────────────────────────────

export interface IHitlWaitRepo {
	create(input: CreateHitlWaitInput): HitlWait;
	get(id: HitlWaitId): HitlWait | undefined;
	getByExecution(executionId: ExecutionId): HitlWait | undefined;
	resolve(id: HitlWaitId, status: HitlWaitStatus, userResponse?: Record<string, unknown>): void;
}

// ─── Audit Event Repo ────────────────────────────────────────────────────────

export interface IAuditEventRepo {
	create(input: CreateAuditEventInput): AuditEvent;
	listByExecution(executionId: ExecutionId): AuditEvent[];
}

// ─── Memory Repo ─────────────────────────────────────────────────────────────

export interface IMemoryRepo {
	create(input: CreateMemoryInput): MemoryEntry;
	get(id: MemoryId): MemoryEntry | undefined;
	list(agentId?: AgentConfigId): MemoryEntry[];
	search(query: string): MemoryEntry[];
	delete(id: MemoryId): void;
}
