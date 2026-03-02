import { OrchestratorClient } from '../client.js';
import type { PaginationOptions, PaginatedResult } from '../types.js';

export class AuthClient {
    constructor(private client: OrchestratorClient) {}

    /**
     * Login with email and password
     */
    public async login(email: string, password?: string, token?: string): Promise<{ token: string; user: any }> {
        const type = token ? 'jwt' : 'local';
        return this.client.request('auth', 'login', { type, email, password, token });
    }

    /**
     * Create a new user
     */
    public async createUser(email: string, password?: string, allowedRoles?: string[]): Promise<{ id: string; email: string; allowedRoles: string[] }> {
        return this.client.request('auth', 'user.create', { email, password, allowedRoles });
    }

    /**
     * Update user roles
     */
    public async updateUserRoles(email: string, allowedRoles: string[]): Promise<void> {
        return this.client.request('auth', 'user.update_roles', { email, allowedRoles });
    }

    /**
     * Update user password
     */
    public async updatePassword(email: string, newPassword: string): Promise<void> {
        return this.client.request('auth', 'user.update_password', { email, newPassword });
    }

    /**
     * List all users
     */
    public async listUsers(options: PaginationOptions = {}): Promise<PaginatedResult<any>> {
        return this.client.request('auth', 'user.list', options);
    }

    /**
     * Add a JWT provider
     */
    public async addProvider(issuer: string, jwksUrl: string, name: string): Promise<{ id: string; issuer: string; jwksUrl: string; name: string }> {
        return this.client.request('auth', 'provider.add', { issuer, jwksUrl, name });
    }

    /**
     * Remove a JWT provider
     */
    public async removeProvider(id: string): Promise<void> {
        return this.client.request('auth', 'provider.remove', { id });
    }

    /**
     * List all JWT providers
     */
    public async listProviders(options: PaginationOptions = {}): Promise<PaginatedResult<any>> {
        return this.client.request('auth', 'provider.list', options);
    }
}
