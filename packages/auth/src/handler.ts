import type { TopicHandler } from '@orch/daemon';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { SessionId } from '@orch/shared';
import type { SessionManager } from './session.js';
import type { UserManager } from './user.js';
import type { JwtValidator } from './jwt.js';
import type { JwtProviderManager } from './jwt-provider.js';
import type { TokenManager, CreateTokenInput, TokenType } from './token-manager.js';

export function createAuthHandler(
    sessionManager: SessionManager,
    userManager: UserManager,
    jwtValidator: JwtValidator,
    jwtProviderManager: JwtProviderManager,
    tokenManager?: TokenManager,
): TopicHandler {
    return async (action, payload: any, context) => {
        const { ws } = context;

        switch (action) {
            case 'login': {
                const { type } = payload;
                let identity: string;
                let roles: string[];

                if (type === 'local') {
                    const { email, password } = payload;
                    if (!email || !password) {
                        throw new OrchestratorError(ErrorCode.INTERNAL_ERROR, 'Email and password required for local login.');
                    }
                    const user = await userManager.verifyPassword(email, password);
                    identity = user.email;
                    roles = user.allowedRoles;
                } else if (type === 'jwt') {
                    const { token } = payload;
                    if (!token) {
                        throw new OrchestratorError(ErrorCode.INTERNAL_ERROR, 'Token required for JWT login.');
                    }
                    
                    const claims = await jwtValidator.validate(token);
                    identity = claims.sub;
                    
                    // Check if user exists, if not auto-provision
                    let user = userManager.findByEmail(identity);
                    if (!user) {
                        // Auto-provision with default 'viewer' role
                        const newUser = await userManager.create(identity, ['viewer']);
                        roles = newUser.allowedRoles;
                    } else {
                        // Validate JWT roles against allowed roles
                        const allowedRoles = new Set(JSON.parse(user.allowed_roles));
                        roles = claims.roles.filter(r => allowedRoles.has(r));
                        
                        // If no roles matched, fallback to viewer if they have it, else empty
                        if (roles.length === 0 && allowedRoles.has('viewer')) {
                            roles = ['viewer'];
                        }
                    }
                } else if (type === 'persistent_token') {
                    // Re-authenticate using a stored persistent token (e.g. after page reload)
                    if (!tokenManager) {
                        throw new OrchestratorError(ErrorCode.SERVICE_UNAVAILABLE, 'Token manager not available.');
                    }
                    const { token: persistentRaw } = payload;
                    if (!persistentRaw || typeof persistentRaw !== 'string') {
                        throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'token is required for persistent_token login.');
                    }
                    const validated = tokenManager.validate(persistentRaw);
                    // Attach the raw token to the WS connection so middleware can auth each subsequent request
                    if (ws) {
                        // @ts-ignore
                        ws.sessionId = persistentRaw;
                    }
                    return { identity: validated.identity, roles: validated.roles, tokenType: validated.tokenType };

                } else {
                    throw new OrchestratorError(ErrorCode.INTERNAL_ERROR, `Unknown login type: ${type}`);
                }

                // Create session
                const { session, token } = sessionManager.create(identity, roles, {
                    ip: ws ? (ws as any)._socket?.remoteAddress : 'unknown'
                });

                // Attach to connection state
                if (ws) {
                    // @ts-ignore
                    ws.sessionId = token;
                }

                return { session, token };
            }

            case 'user.create': {
                const { email, allowedRoles, password } = payload;
                return await userManager.create(email, allowedRoles, password);
            }

            case 'user.update_roles': {
                const { email, allowedRoles } = payload;
                return userManager.updateRoles(email, allowedRoles);
            }

            case 'user.update_password': {
                const { email, newPassword } = payload;
                if (!email || !newPassword) {
                    throw new OrchestratorError(ErrorCode.INTERNAL_ERROR, 'Email and newPassword are required.');
                }
                await userManager.updatePassword(email, newPassword);
                return { success: true };
            }

            case 'user.list': {
                const limit = payload?.limit ? Number(payload.limit) : undefined;
                const offset = payload?.offset ? Number(payload.offset) : undefined;
                return userManager.list({ limit, offset });
            }

            case 'provider.add': {
                const { issuer, jwksUrl, audience } = payload;
                return jwtProviderManager.add(issuer, jwksUrl, audience);
            }

            case 'provider.remove': {
                const { issuer } = payload;
                jwtProviderManager.remove(issuer);
                return { success: true };
            }

            case 'provider.list': {
                const limit = payload?.limit ? Number(payload.limit) : undefined;
                const offset = payload?.offset ? Number(payload.offset) : undefined;
                return jwtProviderManager.list({ limit, offset });
            }

            // ── Session management ────────────────────────────────────────────

            case 'session.refresh': {
                // Extend the idle timeout of the current session
                // @ts-ignore
                const rawToken = ws?.sessionId as string | undefined;
                if (!rawToken || rawToken.startsWith('orch_')) {
                    throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'session.refresh is only valid for interactive sessions.');
                }
                const refreshed = sessionManager.refresh(context.sessionId as SessionId);
                return { session: refreshed };
            }

            case 'session.revoke': {
                // Explicitly end the current session
                // @ts-ignore
                const rawToken = ws?.sessionId as string | undefined;
                if (!rawToken || rawToken.startsWith('orch_')) {
                    throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'session.revoke is only valid for interactive sessions.');
                }
                sessionManager.revoke(context.sessionId as SessionId);
                if (ws) {
                    // @ts-ignore
                    ws.sessionId = undefined;
                }
                return { success: true };
            }

            // ── Persistent token management ───────────────────────────────

            case 'token.create': {
                if (!tokenManager) {
                    throw new OrchestratorError(ErrorCode.SERVICE_UNAVAILABLE, 'Token manager not available.');
                }
                const { name, tokenType, roles: tokenRoles, scopes, ttlSecs } = payload;
                if (!name || typeof name !== 'string') {
                    throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'Token name is required.');
                }
                const input: CreateTokenInput = {
                    name,
                    identity: context.identity ?? 'unknown',
                    tokenType: (tokenType as TokenType) ?? 'user',
                    roles: Array.isArray(tokenRoles) ? tokenRoles : (context.roles ?? []),
                    scopes: Array.isArray(scopes) ? scopes : ['*'],
                    ttlSecs: ttlSecs ? Number(ttlSecs) : undefined,
                };
                const result = tokenManager.create(input);
                return { token: result.token, rawToken: result.rawToken };
            }

            case 'token.list': {
                if (!tokenManager) {
                    throw new OrchestratorError(ErrorCode.SERVICE_UNAVAILABLE, 'Token manager not available.');
                }
                const identity = payload?.identity ?? context.identity;
                if (identity) {
                    return { tokens: tokenManager.listByIdentity(identity) };
                }
                return { tokens: tokenManager.listActive() };
            }

            case 'token.revoke': {
                if (!tokenManager) {
                    throw new OrchestratorError(ErrorCode.SERVICE_UNAVAILABLE, 'Token manager not available.');
                }
                const { tokenId: revokeTokenId } = payload;
                if (!revokeTokenId || typeof revokeTokenId !== 'string') {
                    throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'tokenId is required.');
                }
                tokenManager.revoke(revokeTokenId);
                return { success: true, tokenId: revokeTokenId };
            }

            case 'token.refresh': {
                if (!tokenManager) {
                    throw new OrchestratorError(ErrorCode.SERVICE_UNAVAILABLE, 'Token manager not available.');
                }
                const { tokenId: refreshTokenId, ttlSecs: refreshTtl } = payload;
                if (!refreshTokenId || typeof refreshTokenId !== 'string') {
                    throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'tokenId is required.');
                }
                const refreshed = tokenManager.refresh(refreshTokenId, refreshTtl ? Number(refreshTtl) : undefined);
                return { token: refreshed };
            }

            case 'token.refresh': {
                if (!tokenManager) {
                    throw new OrchestratorError(ErrorCode.SERVICE_UNAVAILABLE, 'Token manager not available.');
                }
                const { tokenId, ttlSecs } = payload;
                if (!tokenId || typeof tokenId !== 'string') {
                    throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'tokenId is required.');
                }
                const refreshed = tokenManager.refresh(tokenId, ttlSecs ? Number(ttlSecs) : undefined);
                return { token: refreshed };
            }

            default:
                throw new OrchestratorError(ErrorCode.UNKNOWN_ACTION, `Unknown auth action: ${action}`);
        }
    };
}
