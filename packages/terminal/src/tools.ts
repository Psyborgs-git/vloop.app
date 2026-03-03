import type { DependencyContainer } from "tsyringe";
import type { AppToolRegistryContract, AppRouterContract, AppToolExecutionContext } from "@orch/shared";

interface TerminalExecuteArgs {
    sessionId?: string;
    command: string;
    shell?: string;
    cwd?: string;
}

export function registerTools(
    _container: DependencyContainer,
    toolRegistry: AppToolRegistryContract,
    router: AppRouterContract,
) {
    toolRegistry.register({
        name: "terminal_execute",
        description: "Executes a command in a managed terminal session.",
        parameters: {
            type: "object",
            properties: {
                sessionId: { type: "string", description: "Existing terminal session ID (optional)" },
                command: { type: "string", description: "Command text to send to the terminal" },
                shell: { type: "string", description: "Shell executable for new sessions" },
                cwd: { type: "string", description: "Working directory for new sessions" },
            },
            required: ["command"],
        },
        execute: async (args: TerminalExecuteArgs, context?: AppToolExecutionContext) => {
            if (!context) throw new Error("Context required for tool execution");
            if (!router.dispatch) throw new Error("Router dispatch is required for tool execution");

            const sessionId = (args.sessionId as string | undefined)
                ?? `tool-term-${Date.now()}`;

            if (!args.sessionId) {
                const spawnRequest = {
                    id: `tool-${Date.now()}-spawn`,
                    topic: 'terminal',
                    action: 'spawn',
                    payload: {
                        sessionId,
                        shell: args.shell,
                        cwd: args.cwd,
                    },
                    meta: {
                        timestamp: new Date().toISOString(),
                        session_id: context.sessionId,
                        trace_id: context.request?.meta?.trace_id,
                    },
                };

                const spawnResponse = await router.dispatch(spawnRequest, context.logger);
                if (spawnResponse.type === 'error') {
                    return { success: false, error: spawnResponse.payload };
                }
            }

            const writeRequest = {
                id: `tool-${Date.now()}-write`,
                topic: 'terminal',
                action: 'write',
                payload: {
                    sessionId,
                    data: `${args.command}\n`,
                },
                meta: {
                    timestamp: new Date().toISOString(),
                    session_id: context.sessionId,
                    trace_id: context.request?.meta?.trace_id,
                },
            };

            const writeResponse = await router.dispatch(writeRequest, context.logger);
            if (writeResponse.type === 'error') {
                return { success: false, error: writeResponse.payload };
            }

            return {
                success: true,
                sessionId,
                message: `Command sent to terminal session ${sessionId}`,
            };
        },
    });
}
