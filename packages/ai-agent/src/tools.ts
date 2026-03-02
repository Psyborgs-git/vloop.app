import type { DependencyContainer } from "tsyringe";
import { TOKENS } from "@orch/shared";
import { AIConfigStore, BrowserTool, createAgentSearchTool } from "./index.js";

export function registerTools(container: DependencyContainer, toolRegistry: any, _router: any): void {
    const logger = container.resolve<any>(TOKENS.Logger);
    const store = container.resolve(AIConfigStore);

    const browserTool = new BrowserTool(logger);
    toolRegistry.register({
        ...browserTool.definition,
        execute: async (args: any) => browserTool.execute(args),
    });

    toolRegistry.register(createAgentSearchTool(store));
}import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { Logger, HandlerContext } from '@orch/daemon';

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: any; // JSON Schema Object
    execute?: (params: any, context?: HandlerContext) => Promise<any>;
}

export class ToolRegistry {
    private readonly tools = new Map<string, ToolDefinition>();

    constructor(private readonly logger: Logger) { }

    public register(tool: ToolDefinition) {
        if (this.tools.has(tool.name)) {
            throw new OrchestratorError(ErrorCode.ALREADY_EXISTS, `Tool already exists: ${tool.name}`);
        }
        this.tools.set(tool.name, tool);
        this.logger.debug({ tool: tool.name }, 'Registered new AI tool');
    }

    public get(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }

    public list(): ToolDefinition[] {
        return Array.from(this.tools.values());
    }
}
