import type { AgentConfigId } from './types.js';
import type { MemoryStore } from './memory-store.js';
import type { KnowledgeGraphService } from './knowledge-graph.js';

export interface RAGPack {
    memorySnippets: string[];
    knowledgeFacts: string[];
}

export class RAGService {
    constructor(
        private readonly memoryStore: MemoryStore,
        private readonly knowledgeGraph: KnowledgeGraphService,
    ) { }

    retrieve(query: string, agentId?: AgentConfigId, maxEntries = 6): RAGPack {
        const memorySnippets = this.memoryStore.composeMemoryContext(query, agentId, maxEntries);
        const knowledgeFacts = this.knowledgeGraph
            .query(agentId, query, Math.max(2, Math.floor(maxEntries / 2)))
            .map(f => `${f.subject} ${f.relation} ${f.object}`);

        return { memorySnippets, knowledgeFacts };
    }
}
