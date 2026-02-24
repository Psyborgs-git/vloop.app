import type { AgentConfigId } from './types.js';
import type { RAGService } from './rag-service.js';

export interface ContextBuildInput {
    agentId?: AgentConfigId;
    userPrompt: string;
    systemPrompt?: string;
    maxChars?: number;
}

export class ContextManager {
    constructor(private readonly ragService: RAGService) { }

    build(input: ContextBuildInput): string {
        const maxChars = input.maxChars ?? 12_000;
        const rag = this.ragService.retrieve(input.userPrompt, input.agentId, 8);

        const blocks: string[] = [];

        if (input.systemPrompt?.trim()) {
            blocks.push(`System instruction:\n${input.systemPrompt.trim()}`);
        }

        if (rag.memorySnippets.length > 0) {
            blocks.push(`Relevant memory:\n${rag.memorySnippets.map(s => `- ${s}`).join('\n')}`);
        }

        if (rag.knowledgeFacts.length > 0) {
            blocks.push(`Knowledge graph facts:\n${rag.knowledgeFacts.map(f => `- ${f}`).join('\n')}`);
        }

        blocks.push(`User:\n${input.userPrompt}`);

        let context = blocks.join('\n\n');
        if (context.length > maxChars) {
            context = context.slice(0, maxChars);
        }

        return context;
    }
}
