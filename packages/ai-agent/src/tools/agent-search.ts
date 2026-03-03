import type { HandlerContext } from '@orch/daemon';
import type { ToolDefinition } from '../tools.js';
import type { IAgentRepo } from '../v2/repos/interfaces.js';
import type { AgentConfig } from '../v2/types.js';

type AgentSearchParams = { query: string };
type AgentSearchResult = {
    found: number;
    agents: Array<{
        id: AgentConfig['id'];
        name: string;
        description: string | undefined;
        modelId: AgentConfig['modelId'];
    }>;
};

export function createAgentSearchTool(store: Pick<IAgentRepo, 'list'>): ToolDefinition<AgentSearchParams, AgentSearchResult> {
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
        execute: async (params: AgentSearchParams, _context?: HandlerContext) => {
            const agents = store.list();
            const query = params.query.toLowerCase();
            
            const results = agents.filter((a: AgentConfig) => 
                a.name.toLowerCase().includes(query) || 
                (a.description && a.description.toLowerCase().includes(query)) ||
                (a.systemPrompt && a.systemPrompt.toLowerCase().includes(query))
            );

            return {
                found: results.length,
                agents: results.map((a: AgentConfig) => ({
                    id: a.id,
                    name: a.name,
                    description: a.description,
                    modelId: a.modelId
                }))
            };
        }
    };
}
