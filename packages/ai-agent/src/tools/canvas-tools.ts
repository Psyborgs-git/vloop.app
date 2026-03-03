import type { HandlerContext } from '@orch/daemon';
import type { ToolDefinition } from '../tools.js';

type DispatchFn = (topic: string, action: string, payload: any, context: HandlerContext) => Promise<unknown>;

function makeTool(def: Omit<ToolDefinition, 'execute'> & { execute: (args: any, context: HandlerContext) => Promise<any> }): ToolDefinition {
    return {
        ...def,
        execute: async (args: any, context?: HandlerContext) => {
            if (!context) throw new Error('Context required for tool execution');
            return def.execute(args, context);
        },
    };
}

export function createCanvasTools(dispatch: DispatchFn): ToolDefinition[] {
    return [
        makeTool({
            name: 'canvas_create',
            description: 'Creates a new dynamic canvas to render custom UI or state.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Name of the canvas' },
                    description: { type: 'string', description: 'Description of the canvas purpose' },
                    content: { type: 'string', description: 'The HTML, CSS, JS or JSON to render' },
                    metadata: { type: 'object', description: 'Custom key-value metadata', additionalProperties: true },
                    message: { type: 'string', description: 'Commit message describing the initial state' }
                },
                required: ['name']
            },
            execute: async (args, context) => {
                const payload = await dispatch('agent', 'canvas.create', args, context);
                return { success: true, canvas: payload };
            },
        }),
        makeTool({
            name: 'canvas_update',
            description: 'Updates an existing canvas content, automatically saving history.',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'The canvas ID to update' },
                    name: { type: 'string', description: 'Optional new name' },
                    description: { type: 'string', description: 'Optional new description' },
                    content: { type: 'string', description: 'The updated HTML, CSS, JS or JSON' },
                    metadata: { type: 'object', description: 'Updated metadata' },
                    message: { type: 'string', description: 'Commit message explaining the changes' }
                },
                required: ['id', 'message']
            },
            execute: async (args, context) => ({ success: true, canvas: await dispatch('agent', 'canvas.update', args, context) }),
        }),
        makeTool({
            name: 'canvas_get',
            description: 'Retrieves the current state of a canvas.',
            parameters: {
                type: 'object',
                properties: { id: { type: 'string', description: 'The canvas ID' } },
                required: ['id']
            },
            execute: async (args, context) => ({ success: true, canvas: await dispatch('agent', 'canvas.get', args, context) }),
        }),
        makeTool({
            name: 'canvas_history',
            description: 'Lists the commit history (versions) of a canvas.',
            parameters: {
                type: 'object',
                properties: { canvasId: { type: 'string', description: 'The canvas ID' } },
                required: ['canvasId']
            },
            execute: async (args, context) => ({ success: true, history: await dispatch('agent', 'canvas.history', args, context) }),
        }),
        makeTool({
            name: 'canvas_rollback',
            description: 'Rolls back a canvas to a specific prior commit.',
            parameters: {
                type: 'object',
                properties: {
                    canvasId: { type: 'string', description: 'The canvas ID' },
                    commitId: { type: 'string', description: 'The commit ID to roll back to' }
                },
                required: ['canvasId', 'commitId']
            },
            execute: async (args, context) => ({ success: true, canvas: await dispatch('agent', 'canvas.rollback', args, context) }),
        }),
        makeTool({
            name: 'canvas_list',
            description: 'Lists all available canvases.',
            parameters: {
                type: 'object',
                properties: { owner: { type: 'string', description: 'Optional owner ID to filter by' } },
                required: []
            },
            execute: async (args, context) => ({ success: true, result: await dispatch('agent', 'canvas.list', args, context) }),
        }),
        makeTool({
            name: 'canvas_delete',
            description: 'Deletes a canvas permanently.',
            parameters: {
                type: 'object',
                properties: { id: { type: 'string', description: 'The canvas ID to delete' } },
                required: ['id']
            },
            execute: async (args, context) => ({ success: true, result: await dispatch('agent', 'canvas.delete', args, context) }),
        }),
        makeTool({
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
            execute: async (args, context) => ({ success: true, result: await dispatch('canvas', 'update_state', args, context) }),
        }),
        makeTool({
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
            execute: async (args, context) => ({ success: true, result: await dispatch('canvas', 'broadcast_event', args, context) }),
        }),
        makeTool({
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
            execute: async (args, context) => ({ success: true, result: await dispatch('canvas', 'toast', args, context) }),
        }),
        makeTool({
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
            execute: async (args, context) => ({ success: true, result: await dispatch('canvas', 'request_input', args, context) }),
        }),
    ];
}
