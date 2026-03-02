import type { DependencyContainer } from "tsyringe";

export function registerTools(_container: DependencyContainer, toolRegistry: any, router: any) {
    toolRegistry.register({
        name: "spawn_container",
        description: "Creates and starts a Docker container.",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "Name of the container" },
                image: { type: "string", description: "Docker image to use (e.g. alpine:latest)" },
                cmd: { type: "array", items: { type: "string" }, description: 'Command to run (e.g. ["ls", "-la"])' },
            },
            required: ["name", "image"],
        },
        execute: async (args: any, context?: any) => {
            if (!context) throw new Error("Context required for tool execution");

            const request = {
                id: `tool-${Date.now()}`,
                topic: 'container',
                action: 'create',
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

            // Start it
            const startReq = {
                ...request,
                action: 'start',
                payload: { name: args.name }
            };
            await router.dispatch(startReq, context.logger);

            return {
                success: true,
                message: "Container " + args.name + " started.",
                containerId: (response.payload as any).id,
            };
        },
    });

    toolRegistry.register({
        name: "inspect_container",
        description: "Gets low-level information on a Docker container.",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "Container name or ID" },
            },
            required: ["name"],
        },
        execute: async (args: any, context?: any) => {
            if (!context) throw new Error("Context required for tool execution");

            const request = {
                id: `tool-${Date.now()}`,
                topic: 'container',
                action: 'inspect',
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
            return { success: true, info: response.payload };
        },
    });
}
