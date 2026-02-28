/**
 * Agent Builder — composes a ready-to-run LlmAgent from stored configs.
 *
 * Takes an AgentConfigId, resolves model + tools, and builds a
 * Google ADK LlmAgent instance with FunctionTools.
 */

import { LlmAgent, FunctionTool } from '@google/adk';
import type { Logger, HandlerContext } from '@orch/daemon';
import type { AIConfigStore } from './store.js';
import type { ProviderRegistry } from './provider-registry.js';
import type { ToolRegistry, ToolDefinition } from '../tools.js';
import type { McpClientManager } from '../mcp/client-manager.js';
import type { AgentConfigId, AgentConfig, ToolConfig, McpServerId } from './types.js';
import type { ResolvedModel } from './provider-registry.js';

export interface BuiltAgent {
    /** The ADK LlmAgent instance. */
    agent: LlmAgent;
    /** The resolved agent config. */
    config: AgentConfig;
    /** The model string used. */
    modelString: string;
    /** Resolved runtime config used to build/execute. */
    runtime: ResolvedModel;
}

export interface BuildAgentOptions {
    /** Optional explicit tool set override (e.g. session-selected tools). */
    toolIds?: string[];
    /** Optional explicit MCP server set override. */
    mcpServerIds?: McpServerId[];
}

export class AgentBuilder {
    constructor(
        private readonly store: AIConfigStore,
        private readonly providerRegistry: ProviderRegistry,
        private readonly builtinTools: ToolRegistry,
        private readonly mcpClientManager: McpClientManager,
        private readonly logger: Logger,
    ) { }

    /**
     * Builds a fully-configured LlmAgent from a stored AgentConfig.
     */
    async build(
        agentId: AgentConfigId,
        vaultGet?: (ref: string) => Promise<string | undefined>,
        context?: HandlerContext,
        options?: BuildAgentOptions,
    ): Promise<BuiltAgent> {
        const agentConfig = this.store.getAgent(agentId);
        if (!agentConfig) throw new Error(`Agent config not found: ${agentId}`);

        // Resolve model
        const resolved = await this.providerRegistry.resolve(agentConfig.modelId, vaultGet, agentConfig.params);

        if (resolved.adapter !== 'adk-native' || !resolved.modelString) {
            throw new Error(`Agent config ${agentId} uses adapter '${resolved.adapter}' which is not ADK-native for LlmAgent build`);
        }

        const effectiveToolIds = options?.toolIds ?? agentConfig.toolIds;
        const effectiveMcpServerIds = options?.mcpServerIds ?? agentConfig.mcpServerIds;

        // Build tools
        const tools = await this.resolveFunctionTools(
            effectiveToolIds,
            effectiveMcpServerIds,
            context,
        );

        // Build the LlmAgent
        const agent = new LlmAgent({
            name: agentConfig.name,
            model: resolved.modelString,
            description: agentConfig.description || undefined,
            instruction: agentConfig.systemPrompt || undefined,
            tools,
            generateContentConfig: {
                temperature: resolved.params.temperature,
                maxOutputTokens: typeof resolved.params.maxTokens === 'number' ? resolved.params.maxTokens : undefined,
                topP: typeof resolved.params.topP === 'number' ? resolved.params.topP : undefined,
                stopSequences: Array.isArray(resolved.params.stop) ? resolved.params.stop : undefined,
            },
        });

        this.logger.info(
            { agentId, model: resolved.modelString, toolCount: tools.length },
            'Built LlmAgent from config',
        );

        return { agent, config: agentConfig, modelString: resolved.modelString, runtime: resolved };
    }

    /**
     * Resolve tool IDs into ADK FunctionTool instances, including MCP tools when requested.
     */
    public async resolveFunctionTools(
        toolIds: string[],
        mcpServerIds?: McpServerId[],
        context?: HandlerContext,
    ): Promise<FunctionTool[]> {
        const tools = this.resolveTools(toolIds, context);

        if (mcpServerIds && mcpServerIds.length > 0) {
            const mcpTools = await this.resolveMcpFunctionTools(mcpServerIds);
            tools.push(...mcpTools);
        }

        return tools;
    }

    /**
     * Resolve tool IDs into raw ToolDefinitions for non-ADK adapters.
     */
    public async resolveToolDefinitions(
        toolIds: string[],
        mcpServerIds?: McpServerId[],
        context?: HandlerContext,
    ): Promise<ToolDefinition[]> {
        const tools: ToolDefinition[] = [];

        for (const toolId of toolIds) {
            // Check builtin tools first
            const builtin = this.builtinTools.get(toolId);
            if (builtin) {
                tools.push(builtin);
                continue;
            }

            // Check user-defined tool configs
            const toolConfig = this.store.getTool(toolId as any);
            if (toolConfig) {
                tools.push({
                    name: toolConfig.name,
                    description: toolConfig.description,
                    parameters: toolConfig.parametersSchema,
                    execute: async (args: any) => {
                        switch (toolConfig.handlerType) {
                            case 'builtin': {
                                const builtinName = (toolConfig.handlerConfig as any).name;
                                const builtinTool = this.builtinTools.get(builtinName);
                                if (!builtinTool?.execute) throw new Error(`Builtin tool not found: ${builtinName}`);
                                return await builtinTool.execute(args, context);
                            }
                            case 'script': {
                                return { error: 'Script tools not yet implemented' };
                            }
                            case 'api': {
                                const url = (toolConfig.handlerConfig as any).url;
                                const method = (toolConfig.handlerConfig as any).method || 'POST';
                                const response = await fetch(url, {
                                    method, headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(args),
                                });
                                return await response.json();
                            }
                            default:
                                throw new Error(`Unknown tool handler type: ${toolConfig.handlerType}`);
                        }
                    }
                });
                continue;
            }

            this.logger.warn({ toolId }, 'Tool not found, skipping');
        }
        
        if (mcpServerIds && mcpServerIds.length > 0) {
            const mcpTools = await this.resolveMcpTools(mcpServerIds);
            tools.push(...mcpTools);
        }

        return tools;
    }

    /**
     * Resolve tool IDs into ADK FunctionTool instances.
     * Checks both user-defined tool configs and builtin tools.
     */
    private resolveTools(
        toolIds: string[],
        context?: HandlerContext,
    ): FunctionTool[] {
        const tools: FunctionTool[] = [];

        for (const toolId of toolIds) {
            // Check builtin tools first
            const builtin = this.builtinTools.get(toolId);
            if (builtin) {
                tools.push(new FunctionTool({
                    name: builtin.name,
                    description: builtin.description,
                    execute: async (args: any) => {
                        return await builtin.execute!(args, context);
                    },
                }));
                continue;
            }

            // Check user-defined tool configs
            const toolConfig = this.store.getTool(toolId as any);
            if (toolConfig) {
                tools.push(this.buildToolFromConfig(toolConfig, context));
                continue;
            }

            this.logger.warn({ toolId }, 'Tool not found, skipping');
        }

        return tools;
    }
    
    /**
     * Resolve MCP server IDs into ToolDefinitions.
     */
    private async resolveMcpTools(serverIds: McpServerId[]): Promise<ToolDefinition[]> {
        // ⚡ Bolt Performance Optimization:
        // Use Promise.all to fetch tools from multiple MCP servers concurrently instead of sequentially.
        // This reduces agent initialization latency by parallelizing network/RPC requests to MCP servers.
        // We return the arrays and flatten them to ensure deterministic tool ordering.
        const nestedTools = await Promise.all(serverIds.map(async (serverId) => {
            const serverConfig = this.store.getMcpServer(serverId);
            if (!serverConfig) {
                this.logger.warn({ serverId }, 'MCP server not found, skipping');
                return [];
            }
            
            try {
                return await this.mcpClientManager.getTools(serverConfig);
            } catch (err) {
                this.logger.error({ err, serverId }, 'Failed to resolve MCP tools');
                return [];
            }
        }));
        
        return nestedTools.flat();
    }

    /**
     * Resolve MCP server IDs into FunctionTool instances.
     */
    private async resolveMcpFunctionTools(serverIds: McpServerId[]): Promise<FunctionTool[]> {
        // ⚡ Bolt Performance Optimization:
        // Use Promise.all to fetch tools from multiple MCP servers concurrently instead of sequentially.
        // This reduces agent initialization latency by parallelizing network/RPC requests to MCP servers.
        // We return the arrays and flatten them to ensure deterministic tool ordering.
        const nestedTools = await Promise.all(serverIds.map(async (serverId) => {
            const serverConfig = this.store.getMcpServer(serverId);
            if (!serverConfig) {
                this.logger.warn({ serverId }, 'MCP server not found, skipping');
                return [];
            }
            
            try {
                const serverTools = await this.mcpClientManager.getTools(serverConfig);
                return serverTools.map((tool) => new FunctionTool({
                    name: tool.name,
                    description: tool.description,
                    execute: async (args: any) => {
                        return await tool.execute!(args);
                    },
                }));
            } catch (err) {
                this.logger.error({ err, serverId }, 'Failed to resolve MCP tools');
                return [];
            }
        }));
        
        return nestedTools.flat();
    }

    /**
     * Builds an ADK FunctionTool from a stored ToolConfig.
     */
    private buildToolFromConfig(config: ToolConfig, context?: HandlerContext): FunctionTool {
        return new FunctionTool({
            name: config.name,
            description: config.description,
            execute: async (args: any) => {
                switch (config.handlerType) {
                    case 'builtin': {
                        const builtinName = (config.handlerConfig as any).name;
                        const builtin = this.builtinTools.get(builtinName);
                        if (!builtin?.execute) throw new Error(`Builtin tool not found: ${builtinName}`);
                        return await builtin.execute(args, context);
                    }
                    case 'script': {
                        // Execute a script via the sandbox (future enhancement)
                        return { error: 'Script tools not yet implemented' };
                    }
                    case 'api': {
                        // Call an external API endpoint
                        const url = (config.handlerConfig as any).url;
                        const method = (config.handlerConfig as any).method || 'POST';
                        const response = await fetch(url, {
                            method, headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(args),
                        });
                        return await response.json();
                    }
                    default:
                        return { error: `Unknown handler type: ${config.handlerType}` };
                }
            },
        });
    }
}
