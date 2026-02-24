/**
 * JWT validation using the `jose` library.
 *
 * Supports dynamic JWKS fetching based on the token's issuer.
 */

import { createRemoteJWKSet, jwtVerify, decodeJwt } from 'jose';
import type { JWTVerifyOptions } from 'jose';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { JwtProviderManager } from './jwt-provider.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface JwtClaims {
    /** Subject — the identity of the token holder. */
    sub: string;
    /** Roles granted to this identity. */
    roles: string[];
    /** Optional scope restrictions. */
    scope?: string;
    /** Token expiration (epoch seconds). */
    exp: number;
    /** Token issue time (epoch seconds). */
    iat: number;
    /** Issuer of the token. */
    iss: string;
}

// ─── Implementation ─────────────────────────────────────────────────────────

export class JwtValidator {
    private providerManager: JwtProviderManager;
    private jwksCache: Map<string, ReturnType<typeof createRemoteJWKSet>> = new Map();

    constructor(providerManager: JwtProviderManager) {
        this.providerManager = providerManager;
    }

    /**
     * Validate a JWT token and extract claims.
     *
     * @throws OrchestratorError with TOKEN_EXPIRED or TOKEN_INVALID codes.
     */
    async validate(token: string): Promise<JwtClaims> {
        try {
            // 1. Decode unverified token to get issuer
            const unverifiedPayload = decodeJwt(token);
            const issuer = unverifiedPayload.iss;

            if (!issuer) {
                throw new OrchestratorError(
                    ErrorCode.TOKEN_INVALID,
                    'JWT missing required "iss" claim.',
                );
            }

            // 2. Look up provider
            const provider = this.providerManager.findByIssuer(issuer);
            if (!provider) {
                throw new OrchestratorError(
                    ErrorCode.AUTH_FAILED,
                    `JWT issuer ${issuer} is not a registered provider.`,
                );
            }

            // 3. Get or create JWKS
            let jwks = this.jwksCache.get(issuer);
            if (!jwks) {
                jwks = createRemoteJWKSet(new URL(provider.jwks_url));
                this.jwksCache.set(issuer, jwks);
            }

            // 4. Verify token
            const verifyOptions: JWTVerifyOptions = {
                issuer: provider.issuer,
                audience: provider.audience,
            };

            const { payload } = await jwtVerify(token, jwks, verifyOptions);

            const sub = payload.sub;
            if (!sub) {
                throw new OrchestratorError(
                    ErrorCode.TOKEN_INVALID,
                    'JWT missing required "sub" claim.',
                );
            }

            // Extract roles — support both array and comma-separated string
            let roles: string[];
            const rawRoles = payload['roles'];
            if (Array.isArray(rawRoles)) {
                roles = rawRoles.map(String);
            } else if (typeof rawRoles === 'string') {
                roles = rawRoles.split(',').map((r) => r.trim());
            } else {
                roles = [];
            }

            return {
                sub,
                roles,
                scope: typeof payload['scope'] === 'string' ? payload['scope'] : undefined,
                exp: payload.exp ?? 0,
                iat: payload.iat ?? 0,
                iss: issuer,
            };
        } catch (err) {
            if (err instanceof OrchestratorError) throw err;

            const message = err instanceof Error ? err.message : String(err);

            if (message.includes('expired') || message.includes('exp')) {
                throw new OrchestratorError(
                    ErrorCode.TOKEN_EXPIRED,
                    'JWT has expired.',
                );
            }

            throw new OrchestratorError(
                ErrorCode.TOKEN_INVALID,
                `JWT validation failed: ${message}`,
            );
        }
    }
}
