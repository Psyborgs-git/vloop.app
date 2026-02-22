import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { Logger } from '@orch/daemon';

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: any; // JSON Schema Object
    execute?: (params: any) => Promise<any>;
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
