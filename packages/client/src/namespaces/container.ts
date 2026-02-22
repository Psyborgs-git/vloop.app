import type { OrchestratorClient } from '../client.js';

export class ContainerClient {
    constructor(private readonly client: OrchestratorClient) { }

    public async create(opts: any): Promise<any> {
        return this.client.request('container', 'create', opts);
    }

    public async start(id: string): Promise<any> {
        return this.client.request('container', 'start', { id });
    }

    public async stop(id: string): Promise<any> {
        return this.client.request('container', 'stop', { id });
    }

    public async list(): Promise<any> {
        return this.client.request('container', 'list');
    }

    public async pull(image: string): Promise<any> {
        return this.client.request('container', 'pull', { image });
    }
}
