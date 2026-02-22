import type { Logger } from '@orch/daemon';
import { ToolRegistry } from './tools.js';
import { AgentSandbox } from './sandbox.js';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { ollama } from 'ollama-ai-provider';
import { streamText, tool, jsonSchema } from 'ai';
import type { LanguageModel } from 'ai';

export interface WorkflowOptions {
    workspaceId: string;
    prompt: string;
    model?: string; // e.g. "openai:gpt-4o" or "anthropic:claude-3-5-sonnet-20240620"
}

export class AgentOrchestrator {
    constructor(
        private readonly tools: ToolRegistry,
        public readonly sandbox: AgentSandbox,
        private readonly logger: Logger,
    ) { }

    private getModel(modelString?: string): LanguageModel {
        const defaultModel = 'openai:gpt-4o-mini';
        const target = modelString || defaultModel;

        const [provider, ...rest] = target.split(':');
        const modelName = rest.join(':');

        if (!modelName) {
            throw new Error('Invalid model format: ' + target + '. Expected provider:modelName');
        }

        switch (provider) {
            case 'openai':
                return openai(modelName);
            case 'anthropic':
                return anthropic(modelName);
            case 'ollama':
                return ollama(modelName) as any;
            default:
                throw new Error('Unsupported LLM provider: ' + provider);
        }
    }

    /**
     * Bootstraps the ReAct execution state machine.
     */
    public async runWorkflow(opts: WorkflowOptions, emit?: (type: 'stream' | 'event', payload: unknown, seq?: number) => void): Promise<any> {
        this.logger.info({ workspaceId: opts.workspaceId, model: opts.model }, 'Starting LLM workflow');

        const model = this.getModel(opts.model);

        // 1. Map Orchestrator ToolRegistry into Vercel AI SDK CoreTools
        const aiTools: Record<string, any> = {};
        for (const t of this.tools.list()) {
            aiTools[t.name] = tool({
                description: t.description,
                parameters: jsonSchema(t.parameters),
                execute: async (args: any) => {
                    this.logger.info({ tool: t.name, args }, 'Agent invoking tool');
                    return await t.execute!(args);
                }
            } as any);
        }

        // 2. Execute the ReAct loop
        const result = await streamText({
            model,
            tools: aiTools,
            system: 'You are the Orchestrator AI Agent. You have root access to a powerful server daemon that can manage containers, spawn processes, and control web browsers. Your job is to fulfill the user requests completely by chaining together your available tools. Only report your final conclusions after using the tools. Plan out your execution.',
            messages: [{ role: 'user', content: opts.prompt }]
        });

        // 3. Consume the stream and emit to client
        let seq = 0;
        for await (const chunk of result.fullStream) {
            if (emit) {
                // chunk.type can be: text-delta, tool-call, tool-result, finish, etc.
                emit('stream', chunk, seq++);
            }
        }

        // 4. Return the payload
        return {
            status: 'completed',
            model: (model as any).provider || opts.model || 'openai',
            result: await result.text,
            toolCalls: await result.toolCalls,
            usage: await result.usage
        };
    }
}
