export type ChatMode = 'chat' | 'agent';

export interface ToolCall { id: string; name: string; arguments: Record<string, unknown>; }
export interface ToolResult { callId: string; result: unknown; }

export interface ChatMessage {
    id?: string;
    role: 'system' | 'assistant' | 'user' | 'tool';
    content: string;
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
    requestedToolConfirmations?: Record<string, unknown>;
    longRunningToolIds?: string[];
    metadata?: Record<string, unknown>;
    createdAt?: string;
}

export interface ChatSession {
    id: string;
    title: string;
    messages: ChatMessage[];
    toolIds: string[];
    updatedAt?: string;
}

export interface ProviderInfo { id: string; name: string; type: string; }
export interface ModelInfo { id: string; name: string; providerId: string; modelId: string; }
export interface ToolInfo { id: string; name: string; description: string; source?: 'builtin' | 'config'; }
export interface AgentInfo { id: string; name: string; description: string; modelId: string; }
