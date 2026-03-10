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

    // ── Persistent Token Management ────────────────────────────────────

    /**
     * Create a persistent API token.
     */
    public async createToken(options: {
        name: string;
        tokenType?: 'user' | 'agent';
        roles?: string[];
        scopes?: string[];
        ttlSecs?: number;
    }): Promise<{ token: any; rawToken: string }> {
        return this.client.request('auth', 'token.create', options);
    }

    /**
     * List persistent tokens for the current identity or a specified one.
     */
    public async listTokens(identity?: string): Promise<{ tokens: any[] }> {
        return this.client.request('auth', 'token.list', { identity });
    }

    /**
     * Re-authenticate using a previously issued persistent token (orch_xxx).
     * Call this on page reload before showing the app, to skip the login screen.
     */
    public async loginWithToken(rawToken: string): Promise<{ identity: string; roles: string[]; tokenType: string }> {
        return this.client.request('auth', 'login', { type: 'persistent_token', token: rawToken });
    }

    /**
     * Revoke a persistent token by its ID.
     */
    public async revokeToken(tokenId: string): Promise<{ success: boolean }> {
        return this.client.request('auth', 'token.revoke', { tokenId });
    }

    /**
     * Extend the expiry of a persistent token. Returns the updated token.
     */
    public async refreshToken(tokenId: string, ttlSecs?: number): Promise<{ id: string; expiresAt: string | null; name: string }> {
        return this.client.request<{ token: any }>('auth', 'token.refresh', { tokenId, ttlSecs })
            .then(res => res.token);
    }

    /**
     * Extend the idle timeout of the current interactive session.
     */
    public async refreshSession(): Promise<{ session: any }> {
        return this.client.request('auth', 'session.refresh', {});
    }

    /**
     * Explicitly revoke the current interactive session.
     */
    public async revokeSession(): Promise<{ success: boolean }> {
        return this.client.request('auth', 'session.revoke', {});
    }
}
