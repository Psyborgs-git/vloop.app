import type { OrchestratorClient } from '../client.js';
import type { PaginationOptions, PaginatedResult } from '../types.js';

export interface TerminalSpawnOptions {
    sessionId?: string;
    shell?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    cols?: number;
    rows?: number;
    profileId?: string;
}

export class TerminalClient {
    constructor(private readonly client: OrchestratorClient) { }

    public async spawn(options: TerminalSpawnOptions = {}): Promise<any> {
        return this.client.request('terminal', 'spawn', options);
    }

    public async write(sessionId: string, data: string): Promise<any> {
        return this.client.request('terminal', 'write', { sessionId, data });
    }

    public async resize(sessionId: string, cols: number, rows: number): Promise<any> {
        return this.client.request('terminal', 'resize', { sessionId, cols, rows });
    }

    public async kill(sessionId: string): Promise<any> {
        return this.client.request('terminal', 'kill', { sessionId });
    }

    public async list(): Promise<any> {
        return this.client.request('terminal', 'list');
    }

    public async scrollback(sessionId: string, lines?: number): Promise<any> {
        return this.client.request('terminal', 'scrollback', { sessionId, lines });
    }

    public async listProfiles(owner?: string): Promise<any> {
        return this.client.request('terminal', 'profile.list', owner ? { owner } : {});
    }

    public async createProfile(input: {
        name: string;
        shell?: string;
        args?: string[];
        cwd?: string;
        env?: Record<string, string>;
        startupCommands?: string[];
        isDefault?: boolean;
    }): Promise<any> {
        return this.client.request('terminal', 'profile.create', input);
    }

    public async updateProfile(id: string, input: {
        name?: string;
        shell?: string;
        args?: string[];
        cwd?: string;
        env?: Record<string, string>;
        startupCommands?: string[];
        isDefault?: boolean;
    }): Promise<any> {
        return this.client.request('terminal', 'profile.update', { id, ...input });
    }

    public async deleteProfile(id: string): Promise<any> {
        return this.client.request('terminal', 'profile.delete', { id });
    }

    public async listSessions(options: PaginationOptions = {}): Promise<PaginatedResult<any>> {
        return this.client.request('terminal', 'session.list', options);
    }

    public async getSession(sessionId: string): Promise<any> {
        return this.client.request('terminal', 'session.get', { sessionId });
    }

    public async sessionLogs(sessionId: string): Promise<any> {
        return this.client.request('terminal', 'session.logs', { sessionId });
    }
}
