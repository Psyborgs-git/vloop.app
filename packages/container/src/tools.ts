import type { DependencyContainer } from "tsyringe";
import type { AppToolRegistryContract, AppRouterContract, AppToolExecutionContext } from "@orch/shared";

interface SpawnContainerArgs {
    name: string;
    image: string;
    cmd?: string[];
}

interface InspectContainerArgs {
    name: string;
}

export function registerTools(
    _container: DependencyContainer,
    toolRegistry: AppToolRegistryContract,
    router: AppRouterContract,
) {
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
        execute: async (args: SpawnContainerArgs, context?: AppToolExecutionContext) => {
            if (!context) throw new Error("Context required for tool execution");
            if (!router.dispatch) throw new Error("Router dispatch is required for tool execution");

            const request = {
                id: `tool-${Date.now()}`,
                topic: 'container',
                action: 'create',
                payload: args,
                meta: {
                    timestamp: new Date().toISOString(),
                    session_id: context.sessionId,
                    trace_id: context.request?.meta?.trace_id,
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
                containerId: typeof response.payload === 'object' && response.payload !== null
                    ? (response.payload as { id?: string }).id
                    : undefined,
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
        execute: async (args: InspectContainerArgs, context?: AppToolExecutionContext) => {
            if (!context) throw new Error("Context required for tool execution");
            if (!router.dispatch) throw new Error("Router dispatch is required for tool execution");

            const request = {
                id: `tool-${Date.now()}`,
                topic: 'container',
                action: 'inspect',
                payload: args,
                meta: {
                    timestamp: new Date().toISOString(),
                    session_id: context.sessionId,
                    trace_id: context.request?.meta?.trace_id,
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
