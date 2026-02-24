/**
 * Memory Store — cross-session knowledge persistence.
 *
 * Simple text-search memory. Foundation for future vector embedding.
 * Wraps AIConfigStore memory methods with search logic.
 */

import type { Logger } from '@orch/daemon';
import type { AIConfigStore } from './store.js';
import type { AgentConfigId, MemoryEntry, CreateMemoryInput } from './types.js';

export class MemoryStore {
    constructor(
        private readonly store: AIConfigStore,
        private readonly logger: Logger,
    ) { }

    /** Add a new memory entry. */
    add(input: CreateMemoryInput): MemoryEntry {
        const entry = this.store.createMemory(input);
        this.logger.debug({ memoryId: entry.id }, 'Memory added');
        return entry;
    }

    /** Persist conversational memories from a user/assistant exchange. */
    ingestConversation(params: {
        agentId?: AgentConfigId;
        sessionId?: string;
        userPrompt: string;
        assistantReply: string;
    }): MemoryEntry[] {
        const created: MemoryEntry[] = [];

        if (params.userPrompt.trim()) {
            created.push(this.add({
                agentId: params.agentId,
                sessionId: params.sessionId as any,
                content: params.userPrompt.trim(),
                sourceType: 'chat',
                importance: 0.5,
                metadata: { role: 'user' },
            }));
        }

        if (params.assistantReply.trim()) {
            created.push(this.add({
                agentId: params.agentId,
                sessionId: params.sessionId as any,
                content: params.assistantReply.trim(),
                sourceType: 'chat',
                importance: 0.6,
                metadata: { role: 'assistant' },
            }));
        }

        return created;
    }

    /** List all memories, optionally filtered by agent. */
    list(agentId?: AgentConfigId): MemoryEntry[] {
        return this.store.listMemories(agentId);
    }

    /** Full-text search over memory content. */
    search(query: string): MemoryEntry[] {
        return this.store.searchMemories(query);
    }

    /** Delete a memory entry. */
    delete(id: string): void {
        this.store.deleteMemory(id as any);
    }

    /**
     * Build a context string from relevant memories for injection into agent prompts.
     */
    buildContext(agentId?: AgentConfigId, maxEntries = 10): string {
        const memories = agentId ? this.store.listMemories(agentId) : this.store.listMemories();
        const relevant = memories.slice(0, maxEntries);

        if (relevant.length === 0) return '';

        return '\n\n--- Relevant Memories ---\n' +
            relevant.map(m => `- ${m.content}`).join('\n') +
            '\n--- End Memories ---\n';
    }

    /** Build a compact memory pack suitable for context manager. */
    composeMemoryContext(query: string, agentId?: AgentConfigId, maxEntries = 6): string[] {
        const searchHits = this.search(query).filter(m => !agentId || m.agentId === agentId);
        const fallback = this.list(agentId);
        const ranked = [...searchHits, ...fallback]
            .filter((entry, index, arr) => arr.findIndex(x => x.id === entry.id) === index)
            .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
            .slice(0, maxEntries);

        return ranked.map(m => m.content);
    }
}
