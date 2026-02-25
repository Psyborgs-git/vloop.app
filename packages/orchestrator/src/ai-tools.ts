import type { ToolDefinition } from '@orch/ai-agent';
import type { Router } from '@orch/daemon';

export function registerAITools(toolRegistry: any, router: Router) {
    const resolveAuthSessionId = (context: import('@orch/daemon').HandlerContext): string => {
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
        execute: async (args: any, context?: import('@orch/daemon').HandlerContext) => {
            if (!context) throw new Error("Context required for tool execution");
            const authSessionId = resolveAuthSessionId(context);

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

            let agents = (response.payload as any).agents || [];
            if (args.query) {
                const q = args.query.toLowerCase();
                agents = agents.filter((a: any) => 
                    a.name.toLowerCase().includes(q) || 
                    (a.description && a.description.toLowerCase().includes(q))
                );
            }

            return {
                success: true,
                agents: agents.map((a: any) => ({
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
        execute: async (args: any, context?: import('@orch/daemon').HandlerContext) => {
            if (!context) throw new Error("Context required for tool execution");
            const authSessionId = resolveAuthSessionId(context);

            // First, create a new chat session for the delegation
            const createSessionReq = {
                id: `tool-${Date.now()}-session`,
                topic: 'agent',
                action: 'chat.create',
                payload: {
                    agentId: args.agentId,
                    title: `Delegated Task: ${args.task.substring(0, 30)}...`
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

            const sessionId = (sessionRes.payload as any).id;

            // Then, run the chat with the agent
            const runChatReq = {
                id: `tool-${Date.now()}-run`,
                topic: 'agent',
                action: 'run.chat',
                payload: {
                    agentId: args.agentId,
                    sessionId: sessionId,
                    prompt: args.task
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
        execute: async (args: any, context?: import('@orch/daemon').HandlerContext) => {
            if (!context) throw new Error("Context required for tool execution");
            const authSessionId = resolveAuthSessionId(context);

            const request = {
                id: `tool-${Date.now()}`,
                topic: 'agent',
                action: 'run.workflow',
                payload: {
                    workflowId: args.workflowId,
                    input: args.input
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
        execute: async (args: any, context?: import('@orch/daemon').HandlerContext) => {
            if (!context) throw new Error("Context required for tool execution");
            const authSessionId = resolveAuthSessionId(context);

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

            let workflows = (response.payload as any).workflows || [];
            if (args.query) {
                const q = args.query.toLowerCase();
                workflows = workflows.filter((w: any) => 
                    w.name.toLowerCase().includes(q) || 
                    (w.description && w.description.toLowerCase().includes(q))
                );
            }

            return {
                success: true,
                workflows: workflows.map((w: any) => ({
                    id: w.id,
                    name: w.name,
                    description: w.description,
                    type: w.type
                }))
            };
        },
    });
}
