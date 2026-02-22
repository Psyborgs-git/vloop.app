import type { OrchestratorClient } from '../client.js';

export class ProcessClient {
    constructor(private readonly client: OrchestratorClient) { }

    public async spawn(opts: any): Promise<any> {
        return this.client.request('process', 'spawn', opts);
    }

    public async kill(id: string): Promise<any> {
        return this.client.request('process', 'kill', { id });
    }

    public async list(): Promise<any> {
        return this.client.request('process', 'list');
    }

    public async getLogs(id: string): Promise<any> {
        return this.client.request('process', 'logs', { id, action: 'tail' });
    }
}
