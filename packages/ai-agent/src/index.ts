/**
 * @orch/ai-agent — Public API surface (v2).
 *
 * All v1 symbols (AIConfigStore, AgentOrchestrator, ProviderRegistry, etc.)
 * have been removed. The package now uses repo-backed, DAG-native orchestration.
 */

// Shared utilities (used by v2 internals and external consumers)
export { AgentSandbox } from './sandbox.js';
export { ToolRegistry } from './tools.js';
export type { ToolDefinition } from './tools.js';
export { BrowserTool } from './tools/browser.js';
export { createAgentSearchTool } from './tools/agent-search.js';
export { createDelegateTaskTool } from './tools/delegate-task.js';
export { createTriggerWorkflowTool } from './tools/trigger-workflow.js';
export { createWorkflowSearchTool } from './tools/workflow-search.js';
export { createCanvasTools } from './tools/canvas-tools.js';

// ── v2 orchestration engine ──────────────────────────────────────────────────

// Orchestrator + handler (the main consumption surface)
export { AgentOrchestratorV2 } from './v2/orchestrator.js';
export type { OrchestratorRepos, AgentChatOptions } from './v2/orchestrator.js';
export { createAgentHandlerV2 } from './v2/handler.js';
export { registerPackageTools } from './routes.js';

// Compat aliases so external code can `import { AgentOrchestrator }` unchanged
export { AgentOrchestratorV2 as AgentOrchestrator } from './v2/orchestrator.js';
export { createAgentHandlerV2 as createAgentHandler } from './v2/handler.js';

// DI
export { V2_REPOS } from './app.js';

// Schema / migrations
export { V2_MIGRATION } from './v2/migrations.js';

// Types (v2 canonical names)
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
} from './v2/types.js';

// Repos interfaces
export type {
	IProviderRepo, IModelRepo, IToolRepo, IMcpServerRepo,
	IAgentRepo, IWorkflowRepo, ISessionRepo, IMessageRepo,
	IStateNodeRepo, IExecutionRepo, IWorkerRunRepo,
	IHitlWaitRepo, IAuditEventRepo, IMemoryRepo,
} from './v2/repos/interfaces.js';

// Repos implementations
export { ProviderRepo } from './v2/repos/provider-repo.js';
export { ModelRepo } from './v2/repos/model-repo.js';
export { ToolRepo } from './v2/repos/tool-repo.js';
export { McpServerRepo } from './v2/repos/mcp-server-repo.js';
export { AgentRepo } from './v2/repos/agent-repo.js';
export { WorkflowRepo } from './v2/repos/workflow-repo.js';
export { SessionRepo } from './v2/repos/session-repo.js';
export { MessageRepo } from './v2/repos/message-repo.js';
export { StateNodeRepo } from './v2/repos/state-node-repo.js';
export { ExecutionRepo } from './v2/repos/execution-repo.js';
export { WorkerRunRepo } from './v2/repos/worker-run-repo.js';
export { HitlWaitRepo } from './v2/repos/hitl-wait-repo.js';
export { AuditEventRepo } from './v2/repos/audit-event-repo.js';
export { MemoryRepo } from './v2/repos/memory-repo.js';
export { CanvasRepo } from './v2/repos/canvas-repo.js';
export type { Canvas, CanvasCommit } from './v2/repos/canvas-repo.js';

// Managers
export { ProviderManager } from './v2/provider-manager.js';
export { MCPManager } from './v2/mcp-manager.js';
export { StateAdapter } from './v2/state-adapter.js';
export { WorkerDispatcher } from './v2/worker/dispatcher.js';
export type { StreamEmitter } from './v2/worker/dispatcher.js';

// Canvas infrastructure
export { createCanvasServer } from './canvas-server.js';
export type { CanvasServerHandle, CanvasStore } from './canvas-server.js';
export { CanvasStateManager } from './canvas-state-manager.js';
export type { CanvasStateManagerOptions, CanvasStateMessage } from './canvas-state-manager.js';
export { registerCanvasRuntimeTopic } from './canvas-runtime-routes.js';

// Event-driven service adapter
export { AiServiceWorker } from './service.js';
export type { AiServiceConfig, AgentHandlerFn } from './service.js';
