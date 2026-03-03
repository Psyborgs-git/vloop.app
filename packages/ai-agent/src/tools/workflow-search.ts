import type { HandlerContext } from '@orch/daemon';
import type { ToolDefinition } from '../tools.js';
import type { IWorkflowRepo } from '../v2/repos/interfaces.js';
import type { WorkflowConfig } from '../v2/types.js';

type WorkflowSearchParams = { query?: string };
type WorkflowSearchResult = {
    success: true;
    workflows: Array<{
        id: WorkflowConfig['id'];
        name: string;
        description: string | undefined;
        type: WorkflowConfig['type'];
    }>;
};

export function createWorkflowSearchTool(store: Pick<IWorkflowRepo, 'list'>): ToolDefinition<WorkflowSearchParams, WorkflowSearchResult> {
    return {
        name: 'search_workflows',
        description: 'Search for available AI workflows in the system.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Optional search query to filter workflows by name or description.'
                }
            }
        },
        execute: async (params: WorkflowSearchParams, _context?: HandlerContext) => {
            let workflows = store.list();
            const query = (params.query || '').toLowerCase().trim();
            if (query) {
                workflows = workflows.filter((w: WorkflowConfig) =>
                    w.name.toLowerCase().includes(query) ||
                    (w.description && w.description.toLowerCase().includes(query))
                );
            }

            return {
                success: true,
                workflows: workflows.map((w: WorkflowConfig) => ({
                    id: w.id,
                    name: w.name,
                    description: w.description,
                    type: w.type,
                })),
            };
        }
    };
}
