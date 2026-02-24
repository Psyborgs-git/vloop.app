import type { Logger } from '@orch/daemon';
import type { AIConfigStore } from './store.js';
import type { AgentConfigId } from './types.js';

export interface KnowledgeFact {
    subject: string;
    relation: string;
    object: string;
}

const STOPWORDS = new Set(['The', 'A', 'An', 'And', 'Or', 'But', 'If', 'Then', 'When', 'Where', 'Who', 'What', 'Why', 'How']);

export class KnowledgeGraphService {
    constructor(
        private readonly store: AIConfigStore,
        private readonly logger: Logger,
    ) { }

    extractFacts(text: string): KnowledgeFact[] {
        const entities = (text.match(/\b[A-Z][A-Za-z0-9_-]{2,}\b/g) || [])
            .filter(entity => !STOPWORDS.has(entity));

        if (entities.length < 2) return [];

        const facts: KnowledgeFact[] = [];
        for (let i = 0; i < entities.length - 1; i++) {
            const subject = entities[i]!;
            const object = entities[i + 1]!;
            facts.push({ subject, relation: 'related_to', object });
        }
        return facts.slice(0, 10);
    }

    indexText(agentId: AgentConfigId | undefined, sessionId: string | undefined, text: string): void {
        const facts = this.extractFacts(text);
        for (const fact of facts) {
            this.store.createMemory({
                agentId,
                sessionId: sessionId as any,
                content: `${fact.subject} ${fact.relation} ${fact.object}`,
                sourceType: 'system',
                importance: 0.4,
                entities: [fact.subject, fact.object],
                metadata: {
                    kind: 'knowledge_fact',
                    ...fact,
                },
            });
        }

        this.logger.debug({ factCount: facts.length }, 'Knowledge facts indexed');
    }

    query(agentId: AgentConfigId | undefined, queryText: string, maxFacts = 6): KnowledgeFact[] {
        const memories = this.store.searchMemories(queryText)
            .filter(memory => !agentId || memory.agentId === agentId)
            .filter(memory => memory.metadata?.kind === 'knowledge_fact')
            .slice(0, maxFacts);

        return memories
            .map(memory => ({
                subject: String(memory.metadata?.subject || ''),
                relation: String(memory.metadata?.relation || 'related_to'),
                object: String(memory.metadata?.object || ''),
            }))
            .filter(fact => fact.subject && fact.object);
    }
}
