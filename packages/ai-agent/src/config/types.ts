/**
 * AI Configuration Domain Types.
 *
 * Single source of truth for all AI config entities.
 * Uses branded IDs matching the @orch/shared pattern.
 */

// ─── Branded IDs ─────────────────────────────────────────────────────────────

type Brand<T, B extends string> = T & { readonly __brand: B };

export type ProviderId = Brand<string, 'ProviderId'>;
export type ModelId = Brand<string, 'ModelId'>;
export type ToolConfigId = Brand<string, 'ToolConfigId'>;
export type AgentConfigId = Brand<string, 'AgentConfigId'>;
export type WorkflowId = Brand<string, 'WorkflowId'>;
export type ChatSessionId = Brand<string, 'ChatSessionId'>;
export type ChatMessageId = Brand<string, 'ChatMessageId'>;
export type MemoryId = Brand<string, 'MemoryId'>;

export function generateId(): string {
    return crypto.randomUUID();
}

// ─── Provider Config ─────────────────────────────────────────────────────────

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
    /** Vault secret path for the API key. */
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

// ─── Model Config ────────────────────────────────────────────────────────────

export interface ModelParams {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    topK?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    stop?: string[];
    /** Allow provider-specific extra metadata. */
    [key: string]: unknown;
}

export interface ModelConfig {
    id: ModelId;
    name: string;
    providerId: ProviderId;
    /** The provider-specific model identifier, e.g. "gpt-4o" or "claude-3-5-sonnet". */
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

// ─── Tool Config ─────────────────────────────────────────────────────────────

export type ToolHandlerType = 'builtin' | 'script' | 'api';

export interface ToolConfig {
    id: ToolConfigId;
    name: string;
    description: string;
    /** JSON Schema object for tool parameters. */
    parametersSchema: Record<string, unknown>;
    handlerType: ToolHandlerType;
    /** Handler-specific config: builtin name, script path, or API endpoint. */
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

// ─── Agent Config ────────────────────────────────────────────────────────────

export interface AgentConfig {
    id: AgentConfigId;
    name: string;
    description: string;
    modelId: ModelId;
    systemPrompt: string;
    toolIds: ToolConfigId[];
    /** Override model params for this agent. */
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
    params?: ModelParams;
}

// ─── Workflow Config (ADK-inspired) ──────────────────────────────────────────

export type WorkflowType = 'sequential' | 'parallel' | 'loop';

export interface WorkflowStep {
    /** Unique step identifier within the workflow. */
    stepId: string;
    /** Either an agent config ID or a nested workflow ID. */
    agentId?: AgentConfigId;
    workflowId?: WorkflowId;
    /** Input mapping: maps step input keys to previous step output keys. */
    inputMapping?: Record<string, string>;
    /** For loop workflows: condition expression to continue looping. */
    condition?: string;
    /** Max iterations for loop workflows. */
    maxIterations?: number;
}

export interface WorkflowConfig {
    id: WorkflowId;
    name: string;
    description: string;
    type: WorkflowType;
    steps: WorkflowStep[];
    createdAt: string;
    updatedAt: string;
}

export interface CreateWorkflowInput {
    name: string;
    description?: string;
    type: WorkflowType;
    steps: WorkflowStep[];
}

// ─── Chat Session ────────────────────────────────────────────────────────────

export interface ChatSession {
    id: ChatSessionId;
    agentId?: AgentConfigId;
    workflowId?: WorkflowId;
    modelId?: ModelId;
    providerId?: ProviderId;
    mode?: 'chat' | 'agent' | 'workflow';
    title: string;
    createdAt: string;
    updatedAt: string;
}

export interface CreateChatSessionInput {
    agentId?: AgentConfigId;
    workflowId?: WorkflowId;
    modelId?: ModelId;
    providerId?: ProviderId;
    mode?: 'chat' | 'agent' | 'workflow';
    title?: string;
}

// ─── Chat Message ────────────────────────────────────────────────────────────

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export interface ToolResult {
    callId: string;
    result: unknown;
}

export interface ChatMessage {
    id: ChatMessageId;
    sessionId: ChatSessionId;
    role: MessageRole;
    content: string;
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
    providerType?: ProviderType;
    modelId?: string;
    finishReason?: string;
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
    };
    latencyMs?: number;
    metadata?: Record<string, unknown>;
    createdAt: string;
}

export interface CreateChatMessageInput {
    sessionId: ChatSessionId;
    role: MessageRole;
    content: string;
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
    providerType?: ProviderType;
    modelId?: string;
    finishReason?: string;
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
    };
    latencyMs?: number;
    metadata?: Record<string, unknown>;
}

// ─── Memory ──────────────────────────────────────────────────────────────────

export interface MemoryEntry {
    id: MemoryId;
    sessionId?: ChatSessionId;
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
    sessionId?: ChatSessionId;
    agentId?: AgentConfigId;
    content: string;
    sourceType?: 'chat' | 'tool' | 'document' | 'system';
    importance?: number;
    topic?: string;
    entities?: string[];
    metadata?: Record<string, unknown>;
}
