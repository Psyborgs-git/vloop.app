import { OrchestratorClient } from '../client.js';

export class AgentClient {
    constructor(private readonly client: OrchestratorClient) { }

    public async runWorkflow(workspaceId: string, prompt: string, model?: string): Promise<any> {
        return this.client.request('agent', 'workflow', { workspaceId, prompt, model });
    }

    public invokeStream(workspaceId: string, prompt: string, model?: string): AsyncGenerator<any, any, undefined> {
        return this.client.requestStream<any, any>('agent', 'workflow', { workspaceId, prompt, model });
    }
}
