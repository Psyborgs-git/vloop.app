import type { HandlerContext } from '@orch/daemon';
import type { ToolDefinition } from '../tools.js';
import type { AIConfigStore } from '../config/store.js';

export function createAgentSearchTool(store: AIConfigStore): ToolDefinition {
    return {
        name: 'agent_search',
        description: 'Search for available AI agents by name, description, or capabilities.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'The search query to find relevant agents.'
                }
            },
            required: ['query']
        },
        execute: async (params: { query: string }, _context?: HandlerContext) => {
            const agents = await store.listAgents();
            const query = params.query.toLowerCase();
            
            const results = agents.filter(a => 
                a.name.toLowerCase().includes(query) || 
                (a.description && a.description.toLowerCase().includes(query)) ||
                (a.systemPrompt && a.systemPrompt.toLowerCase().includes(query))
            );

            return {
                found: results.length,
                agents: results.map(a => ({
                    id: a.id,
                    name: a.name,
                    description: a.description,
                    modelId: a.modelId
                }))
            };
        }
    };
}
