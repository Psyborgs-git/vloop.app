import type { ToolRegistry } from '@orch/ai-agent';
import type { Router } from '@orch/daemon';

async function dispatchToolAction(
    router: Router,
    context: import('@orch/daemon').HandlerContext,
    topic: string,
    action: string,
    payload: any,
) {
    return router.dispatch({
        id: `tool-${Date.now()}`,
        topic,
        action,
        payload,
        meta: {
            session_id: context.sessionId,
            trace_id: context.request.meta.trace_id,
            timestamp: new Date().toISOString(),
        },
    }, context.logger);
}

export function registerCanvasTools(toolRegistry: ToolRegistry, router: Router): void {
    toolRegistry.register({
        name: "canvas_create",
        description: "Creates a new dynamic canvas to render custom UI or state.",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "Name of the canvas" },
                description: { type: "string", description: "Description of the canvas purpose" },
                content: { type: "string", description: "The HTML, CSS, JS or JSON to render" },
                metadata: { type: "object", description: "Custom key-value metadata", additionalProperties: true },
                message: { type: "string", description: "Commit message describing the initial state" }
            },
            required: ["name"]
        },
        execute: async (args: any, context?: import('@orch/daemon').HandlerContext) => {
            if (!context) throw new Error("Context required for tool execution");
            const response = await dispatchToolAction(router, context, 'agent', 'canvas.create', args);
            
            if (response.type === 'error') return { success: false, error: response.payload };
            return { success: true, canvas: response.payload };
        }
    });

    toolRegistry.register({
        name: "canvas_update",
        description: "Updates an existing canvas content, automatically saving history.",
        parameters: {
            type: "object",
            properties: {
                id: { type: "string", description: "The canvas ID to update" },
                name: { type: "string", description: "Optional new name" },
                description: { type: "string", description: "Optional new description" },
                content: { type: "string", description: "The updated HTML, CSS, JS or JSON" },
                metadata: { type: "object", description: "Updated metadata" },
                message: { type: "string", description: "Commit message explaining the changes" }
            },
            required: ["id", "message"]
        },
        execute: async (args: any, context?: import('@orch/daemon').HandlerContext) => {
            if (!context) throw new Error("Context required for tool execution");
            const response = await dispatchToolAction(router, context, 'agent', 'canvas.update', args);
            
            if (response.type === 'error') return { success: false, error: response.payload };
            return { success: true, canvas: response.payload };
        }
    });

    toolRegistry.register({
        name: "canvas_get",
        description: "Retrieves the current state of a canvas.",
        parameters: {
            type: "object",
            properties: {
                id: { type: "string", description: "The canvas ID" }
            },
            required: ["id"]
        },
        execute: async (args: any, context?: import('@orch/daemon').HandlerContext) => {
            if (!context) throw new Error("Context required for tool execution");
            const response = await dispatchToolAction(router, context, 'agent', 'canvas.get', args);
            
            if (response.type === 'error') return { success: false, error: response.payload };
            return { success: true, canvas: response.payload };
        }
    });

    toolRegistry.register({
        name: "canvas_history",
        description: "Lists the commit history (versions) of a canvas.",
        parameters: {
            type: "object",
            properties: {
                canvasId: { type: "string", description: "The canvas ID" }
            },
            required: ["canvasId"]
        },
        execute: async (args: any, context?: import('@orch/daemon').HandlerContext) => {
            if (!context) throw new Error("Context required for tool execution");
            const response = await dispatchToolAction(router, context, 'agent', 'canvas.history', args);
            
            if (response.type === 'error') return { success: false, error: response.payload };
            return { success: true, history: response.payload };
        }
    });

    toolRegistry.register({
        name: "canvas_rollback",
        description: "Rolls back a canvas to a specific prior commit.",
        parameters: {
            type: "object",
            properties: {
                canvasId: { type: "string", description: "The canvas ID" },
                commitId: { type: "string", description: "The commit ID to roll back to" }
            },
            required: ["canvasId", "commitId"]
        },
        execute: async (args: any, context?: import('@orch/daemon').HandlerContext) => {
            if (!context) throw new Error("Context required for tool execution");
            const response = await dispatchToolAction(router, context, 'agent', 'canvas.rollback', args);
            
            if (response.type === 'error') return { success: false, error: response.payload };
            return { success: true, canvas: response.payload };
        }
    });

    toolRegistry.register({
        name: "canvas_list",
        description: "Lists all available canvases.",
        parameters: {
            type: "object",
            properties: {
                owner: { type: "string", description: "Optional owner ID to filter by" }
            },
            required: []
        },
        execute: async (args: any, context?: import('@orch/daemon').HandlerContext) => {
            if (!context) throw new Error("Context required for tool execution");
            const response = await dispatchToolAction(router, context, 'agent', 'canvas.list', args);
            
            if (response.type === 'error') return { success: false, error: response.payload };
            return { success: true, result: response.payload };
        }
    });

    toolRegistry.register({
        name: "canvas_delete",
        description: "Deletes a canvas permanently.",
        parameters: {
            type: "object",
            properties: {
                id: { type: "string", description: "The canvas ID to delete" }
            },
            required: ["id"]
        },
        execute: async (args: any, context?: import('@orch/daemon').HandlerContext) => {
            if (!context) throw new Error("Context required for tool execution");
            const response = await dispatchToolAction(router, context, 'agent', 'canvas.delete', args);
            
            if (response.type === 'error') return { success: false, error: response.payload };
            return { success: true, result: response.payload };
        }
    });

    toolRegistry.register({
        name: 'canvas_ipc_update_state',
        description: 'Pushes partial realtime state to a live canvas via IPC.',
        parameters: {
            type: 'object',
            properties: {
                canvasId: { type: 'string', description: 'Target canvas ID' },
                state: { type: 'object', description: 'Partial state patch', additionalProperties: true },
            },
            required: ['canvasId', 'state'],
        },
        execute: async (args: any, context?: import('@orch/daemon').HandlerContext) => {
            if (!context) throw new Error('Context required for tool execution');
            const response = await dispatchToolAction(router, context, 'canvas', 'update_state', args);
            if (response.type === 'error') return { success: false, error: response.payload };
            return { success: true, result: response.payload };
        },
    });

    toolRegistry.register({
        name: 'canvas_ipc_event',
        description: 'Broadcasts an IPC event to all clients connected to a canvas.',
        parameters: {
            type: 'object',
            properties: {
                canvasId: { type: 'string', description: 'Target canvas ID' },
                type: { type: 'string', description: 'Event type' },
                payload: { type: 'object', description: 'Event payload', additionalProperties: true },
            },
            required: ['canvasId', 'type'],
        },
        execute: async (args: any, context?: import('@orch/daemon').HandlerContext) => {
            if (!context) throw new Error('Context required for tool execution');
            const response = await dispatchToolAction(router, context, 'canvas', 'broadcast_event', args);
            if (response.type === 'error') return { success: false, error: response.payload };
            return { success: true, result: response.payload };
        },
    });

    toolRegistry.register({
        name: 'canvas_ipc_toast',
        description: 'Shows an animated toast notification overlay on the target canvas.',
        parameters: {
            type: 'object',
            properties: {
                canvasId: { type: 'string', description: 'Target canvas ID' },
                message: { type: 'string', description: 'Toast message text' },
                severity: { type: 'string', enum: ['success', 'error', 'warning', 'info'], description: 'Toast style variant' },
                durationMs: { type: 'number', description: 'Optional toast duration in milliseconds' },
            },
            required: ['canvasId', 'message'],
        },
        execute: async (args: any, context?: import('@orch/daemon').HandlerContext) => {
            if (!context) throw new Error('Context required for tool execution');
            const response = await dispatchToolAction(router, context, 'canvas', 'toast', args);
            if (response.type === 'error') return { success: false, error: response.payload };
            return { success: true, result: response.payload };
        },
    });

    toolRegistry.register({
        name: 'canvas_ipc_input_dialog',
        description: 'Prompts the user for input in an animated canvas overlay dialog and waits for a response.',
        parameters: {
            type: 'object',
            properties: {
                canvasId: { type: 'string', description: 'Target canvas ID' },
                title: { type: 'string', description: 'Dialog title' },
                message: { type: 'string', description: 'Dialog prompt message' },
                placeholder: { type: 'string', description: 'Input placeholder text' },
                defaultValue: { type: 'string', description: 'Default input value' },
                confirmLabel: { type: 'string', description: 'Confirm button label' },
                cancelLabel: { type: 'string', description: 'Cancel button label' },
                inputType: { type: 'string', enum: ['text', 'password', 'number', 'email'], description: 'Input field type' },
                timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds' },
            },
            required: ['canvasId', 'message'],
        },
        execute: async (args: any, context?: import('@orch/daemon').HandlerContext) => {
            if (!context) throw new Error('Context required for tool execution');
            const response = await dispatchToolAction(router, context, 'canvas', 'request_input', args);
            if (response.type === 'error') return { success: false, error: response.payload };
            return { success: true, result: response.payload };
        },
    });
}
