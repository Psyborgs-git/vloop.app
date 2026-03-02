import type { DependencyContainer } from "tsyringe";

export function registerTools(_container: DependencyContainer, toolRegistry: any, router: any) {
    toolRegistry.register({
        name: "spawn_process",
        description: "Spawns a new background process or command.",
        parameters: {
            type: "object",
            properties: {
                id: { type: "string", description: "Unique identifier for the process" },
                command: { type: "string", description: "The executable command" },
                args: { type: "array", items: { type: "string" }, description: "Command arguments" },
                cwd: { type: "string", description: "Working directory" },
                restartPolicy: {
                    type: "string",
                    enum: ["always", "on-failure", "never"],
                    description: "Restart policy",
                },
            },
            required: ["id", "command"],
        },
        execute: async (args: any, context?: any) => {
            if (!context) throw new Error("Context required for tool execution");

            const request = {
                id: `tool-${Date.now()}`,
                topic: 'process',
                action: 'spawn',
                payload: args,
                meta: {
                    timestamp: new Date().toISOString(),
                    session_id: context.sessionId,
                    trace_id: context.request.meta.trace_id
                }
            };

            const response = await router.dispatch(request, context.logger);
            if (response.type === 'error') {
                return { success: false, error: response.payload };
            }
            return { success: true, message: "Process " + args.id + " started." };
        },
    });
}
