/**
 * @orch/ai-agent v2 — Public API surface.
 */

// Core orchestrator
export { AgentOrchestratorV2 } from './orchestrator.js';
export type { OrchestratorRepos, AgentChatOptions } from './orchestrator.js';

// Handler
export { createAgentHandlerV2 } from './handler.js';

// Types
export type {
	ProviderId, ModelId, ToolConfigId, AgentConfigId,
	WorkflowId, WorkflowVersionId, SessionId, MessageId,
	StateNodeId, ExecutionId, McpServerId, MemoryId,
	HitlWaitId, WorkerRunId, AuditEventId,
	CanvasId, CanvasCommitId,
	ProviderConfig, CreateProviderInput,
	ModelConfig, CreateModelInput, ModelParams,
	ToolConfig, CreateToolInput,
	AgentConfig, CreateAgentInput,
	WorkflowConfig, CreateWorkflowInput, WorkflowNode, WorkflowEdge,
	WorkflowVersion,
	Session, CreateSessionInput,
	Message, CreateMessageInput,
	StateNode, CreateStateNodeInput, StateNodeKind,
	Execution, CreateExecutionInput,
	WorkerRun, CreateWorkerRunInput,
	HitlWait, CreateHitlWaitInput,
	AuditEvent, CreateAuditEventInput,
	MemoryEntry, CreateMemoryInput,
	ResolvedModel,
} from './types.js';

// Schema (for external migration runners)
export { V2_MIGRATION } from './migrations.js';

// Repos interfaces
export type {
	IProviderRepo, IModelRepo, IToolRepo, IMcpServerRepo,
	IAgentRepo, IWorkflowRepo, ISessionRepo, IMessageRepo,
	IStateNodeRepo, IExecutionRepo, IWorkerRunRepo,
	IHitlWaitRepo, IAuditEventRepo, IMemoryRepo,
} from './repos/interfaces.js';

// Repos implementations
export { ProviderRepo } from './repos/provider-repo.js';
export { ModelRepo } from './repos/model-repo.js';
export { ToolRepo } from './repos/tool-repo.js';
export { McpServerRepo } from './repos/mcp-server-repo.js';
export { AgentRepo } from './repos/agent-repo.js';
export { WorkflowRepo } from './repos/workflow-repo.js';
export { SessionRepo } from './repos/session-repo.js';
export { MessageRepo } from './repos/message-repo.js';
export { StateNodeRepo } from './repos/state-node-repo.js';
export { ExecutionRepo } from './repos/execution-repo.js';
export { WorkerRunRepo } from './repos/worker-run-repo.js';
export { HitlWaitRepo } from './repos/hitl-wait-repo.js';
export { AuditEventRepo } from './repos/audit-event-repo.js';
export { MemoryRepo } from './repos/memory-repo.js';
export { CanvasRepo } from './repos/canvas-repo.js';
export type { Canvas, CanvasCommit } from './repos/canvas-repo.js';

// Managers
export { ProviderManager } from './provider-manager.js';
export { MCPManager } from './mcp-manager.js';
export { StateAdapter } from './state-adapter.js';

// Worker
export { WorkerDispatcher } from './worker/dispatcher.js';
export type { StreamEmitter } from './worker/dispatcher.js';

// DI
export { V2_REPOS } from '../app.js';
