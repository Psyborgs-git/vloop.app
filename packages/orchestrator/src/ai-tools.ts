import type { ToolRegistry } from '@orch/ai-agent';
import type { Router } from '@orch/daemon';
import type { HandlerContext, Response } from '@orch/daemon';

type AgentSummary = { id: string; name: string; description?: string; systemPrompt?: string };
type WorkflowSummary = { id: string; name: string; description?: string; type?: string };

type AgentListPayload = { agents?: AgentSummary[] };
type WorkflowListPayload = { workflows?: WorkflowSummary[] };

const getPayload = <T>(response: Response): T => (response.payload as T);
const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
const asString = (value: unknown): string | undefined =>
    typeof value === 'string' ? value : undefined;

export function registerAITools(toolRegistry: ToolRegistry, router: Router) {
    const resolveAuthSessionId = (context: HandlerContext): string => {
        const fromRequest = context.request?.meta?.session_id;
        if (fromRequest) return fromRequest;
        if (context.sessionId) return context.sessionId;
        throw new Error('Authenticated session id is required for internal tool dispatch');
    };

    // 1. Search Agents Tool
    toolRegistry.register({
        name: "search_agents",
        description: "Search for available AI agents in the system to delegate tasks to.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Optional search query to filter agents by name or description",
                },
            },
        },
        execute: async (args: unknown, context?: HandlerContext) => {
            if (!context) throw new Error("Context required for tool execution");
            const authSessionId = resolveAuthSessionId(context);
            const input = asRecord(args);

            const request = {
                id: `tool-${Date.now()}`,
                topic: 'agent',
                action: 'config.list',
                payload: {},
                meta: {
                    timestamp: new Date().toISOString(),
                    session_id: authSessionId,
                    trace_id: context.request.meta.trace_id
                }
            };

            const response = await router.dispatch(request, context.logger);
            if (response.type === 'error') {
                return { success: false, error: response.payload };
            }

            let agents = getPayload<AgentListPayload>(response).agents ?? [];
            const query = asString(input.query)?.toLowerCase();
            if (query) {
                agents = agents.filter((a) => 
                    a.name.toLowerCase().includes(query) || 
                    (a.description && a.description.toLowerCase().includes(query))
                );
            }

            return {
                success: true,
                agents: agents.map((a) => ({
                    id: a.id,
                    name: a.name,
                    description: a.description,
                    systemPrompt: a.systemPrompt
                }))
            };
        },
    });

    // 2. Delegate Task Tool
    toolRegistry.register({
        name: "delegate_task",
        description: "Delegate a task to another AI agent by starting a new chat session with them.",
        parameters: {
            type: "object",
            properties: {
                agentId: {
                    type: "string",
                    description: "The ID of the agent to delegate the task to",
                },
                task: {
                    type: "string",
                    description: "The task description or prompt to send to the agent",
                },
            },
            required: ["agentId", "task"],
        },
        execute: async (args: unknown, context?: HandlerContext) => {
            if (!context) throw new Error("Context required for tool execution");
            const authSessionId = resolveAuthSessionId(context);
            const input = asRecord(args);

            const agentId = asString(input.agentId);
            const task = asString(input.task);
            if (!agentId || !task) {
                throw new Error('agentId and task are required');
            }

            // First, create a new chat session for the delegation
            const createSessionReq = {
                id: `tool-${Date.now()}-session`,
                topic: 'agent',
                action: 'chat.create',
                payload: {
                    agentId,
                    title: `Delegated Task: ${task.substring(0, 30)}...`
                },
                meta: {
                    timestamp: new Date().toISOString(),
                    session_id: authSessionId,
                    trace_id: context.request.meta.trace_id
                }
            };

            const sessionRes = await router.dispatch(createSessionReq, context.logger);
            if (sessionRes.type === 'error') {
                return { success: false, error: sessionRes.payload };
            }

            const sessionPayload = getPayload<{ id?: string }>(sessionRes);
            const sessionId = sessionPayload.id;
            if (!sessionId) {
                return { success: false, error: 'Failed to create delegation session' };
            }

            // Then, run the chat with the agent
            const runChatReq = {
                id: `tool-${Date.now()}-run`,
                topic: 'agent',
                action: 'run.chat',
                payload: {
                    agentId,
                    sessionId: sessionId,
                    prompt: task
                },
                meta: {
                    timestamp: new Date().toISOString(),
                    session_id: authSessionId,
                    trace_id: context.request.meta.trace_id
                }
            };

            const runRes = await router.dispatch(runChatReq, context.logger);
            if (runRes.type === 'error') {
                return { success: false, error: runRes.payload };
            }

            return {
                success: true,
                sessionId,
                response: runRes.payload
            };
        },
    });

    // 3. Trigger Workflow Tool
    toolRegistry.register({
        name: "trigger_workflow",
        description: "Trigger an existing AI workflow with the specified input.",
        parameters: {
            type: "object",
            properties: {
                workflowId: {
                    type: "string",
                    description: "The ID of the workflow to trigger",
                },
                input: {
                    type: "object",
                    description: "The input data for the workflow",
                },
            },
            required: ["workflowId", "input"],
        },
        execute: async (args: unknown, context?: HandlerContext) => {
            if (!context) throw new Error("Context required for tool execution");
            const authSessionId = resolveAuthSessionId(context);
            const input = asRecord(args);

            const workflowId = asString(input.workflowId);
            if (!workflowId) {
                throw new Error('workflowId is required');
            }

            const request = {
                id: `tool-${Date.now()}`,
                topic: 'agent',
                action: 'run.workflow',
                payload: {
                    workflowId,
                    input: input.input
                },
                meta: {
                    timestamp: new Date().toISOString(),
                    session_id: authSessionId,
                    trace_id: context.request.meta.trace_id
                }
            };

            const response = await router.dispatch(request, context.logger);
            if (response.type === 'error') {
                return { success: false, error: response.payload };
            }

            return {
                success: true,
                result: response.payload
            };
        },
    });

    // 4. Search Workflows Tool
    toolRegistry.register({
        name: "search_workflows",
        description: "Search for available AI workflows in the system.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Optional search query to filter workflows by name or description",
                },
            },
        },
        execute: async (args: unknown, context?: HandlerContext) => {
            if (!context) throw new Error("Context required for tool execution");
            const authSessionId = resolveAuthSessionId(context);
            const input = asRecord(args);

            const request = {
                id: `tool-${Date.now()}`,
                topic: 'agent',
                action: 'workflow.list',
                payload: {},
                meta: {
                    timestamp: new Date().toISOString(),
                    session_id: authSessionId,
                    trace_id: context.request.meta.trace_id
                }
            };

            const response = await router.dispatch(request, context.logger);
            if (response.type === 'error') {
                return { success: false, error: response.payload };
            }

            let workflows = getPayload<WorkflowListPayload>(response).workflows ?? [];
            const query = asString(input.query)?.toLowerCase();
            if (query) {
                workflows = workflows.filter((w) => 
                    w.name.toLowerCase().includes(query) || 
                    (w.description && w.description.toLowerCase().includes(query))
                );
            }

            return {
                success: true,
                workflows: workflows.map((w) => ({
                    id: w.id,
                    name: w.name,
                    description: w.description,
                    type: w.type
                }))
            };
        },
    });
}
