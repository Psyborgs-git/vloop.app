/**
 * @orch/ai-agent — Public API surface.
 */

// Core components
export { AgentSandbox } from './sandbox.js';
export { ToolRegistry } from './tools.js';
export type { ToolDefinition } from './tools.js';
export { AgentOrchestrator } from './orchestrator.js';
export { createAgentHandler } from './handler.js';
export { BrowserTool } from './tools/browser.js';

// Config system
export { AIConfigStore } from './config/store.js';
export { ProviderRegistry } from './config/provider-registry.js';
export { AgentBuilder } from './config/agent-builder.js';
export { WorkflowRunner } from './config/workflow-runner.js';
export { MemoryStore } from './config/memory-store.js';
export { OllamaSync } from './config/ollama-sync.js';
export { RAGService } from './config/rag-service.js';
export { ContextManager } from './config/context-manager.js';
export { KnowledgeGraphService } from './config/knowledge-graph.js';

// Config types
export type {
    ProviderConfig, CreateProviderInput, ProviderType, ProviderId,
    ProviderAdapter, ProviderAuthType,
    ModelConfig, CreateModelInput, ModelParams, ModelId,
    ToolConfig, CreateToolInput, ToolHandlerType, ToolConfigId,
    AgentConfig, CreateAgentInput, AgentConfigId,
    WorkflowConfig, CreateWorkflowInput, WorkflowType, WorkflowStep, WorkflowId,
    ChatSession, CreateChatSessionInput, ChatSessionId,
    ChatMessage, CreateChatMessageInput, ChatMessageId, MessageRole,
    MemoryEntry, CreateMemoryInput, MemoryId,
} from './config/types.js';
