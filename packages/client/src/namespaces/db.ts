import { OrchestratorClient } from '../client.js';

export class DbClient {
    constructor(private readonly client: OrchestratorClient) { }

    public async provision(workspaceId: string, description?: string): Promise<any> {
        return this.client.request('db', 'provision', { workspaceId, description });
    }

    public async query(workspaceId: string, dbId: string, sql: string, params?: any[]): Promise<any> {
        return this.client.request('db', 'query', { workspaceId, dbId, sql, params });
    }

    public async disconnect(workspaceId: string, dbId: string): Promise<any> {
        return this.client.request('db', 'disconnect', { workspaceId, dbId });
    }
}
