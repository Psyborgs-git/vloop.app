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
import type { AgentConfigId, AgentConfig, ToolConfig } from './types.js';
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

export class AgentBuilder {
    constructor(
        private readonly store: AIConfigStore,
        private readonly providerRegistry: ProviderRegistry,
        private readonly builtinTools: ToolRegistry,
        private readonly logger: Logger,
    ) { }

    /**
     * Builds a fully-configured LlmAgent from a stored AgentConfig.
     */
    async build(
        agentId: AgentConfigId,
        vaultGet?: (ref: string) => Promise<string | undefined>,
        context?: HandlerContext,
    ): Promise<BuiltAgent> {
        const agentConfig = this.store.getAgent(agentId);
        if (!agentConfig) throw new Error(`Agent config not found: ${agentId}`);

        // Resolve model
        const resolved = await this.providerRegistry.resolve(agentConfig.modelId, vaultGet, agentConfig.params);

        if (resolved.adapter !== 'adk-native' || !resolved.modelString) {
            throw new Error(`Agent config ${agentId} uses adapter '${resolved.adapter}' which is not ADK-native for LlmAgent build`);
        }

        // Build tools
        const tools = this.resolveTools(agentConfig.toolIds, context);

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
     * Resolve tool IDs into raw ToolDefinitions for non-ADK adapters.
     */
    public resolveToolDefinitions(
        toolIds: string[],
        context?: HandlerContext,
    ): ToolDefinition[] {
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
