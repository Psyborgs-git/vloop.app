import { OrchestratorClient } from '../client.js';

export class VaultClient {
    constructor(private readonly client: OrchestratorClient) { }

    public async get(path: string): Promise<any> {
        return this.client.request('vault', 'secret.read', { path });
    }

    public async put(path: string, value: string, description?: string): Promise<any> {
        return this.client.request('vault', 'secret.write', { path, value, description });
    }

    public async delete(path: string): Promise<any> {
        return this.client.request('vault', 'secret.delete', { path });
    }

    public async list(prefix?: string): Promise<any> {
        return this.client.request('vault', 'secret.list', { prefix });
    }
}
