/**
 * JWT validation using the `jose` library.
 *
 * Supports RS256, ES256, and EdDSA algorithms.
 * Loads public keys from PEM files for signature verification.
 */

import { importSPKI, jwtVerify } from 'jose';
import type { JWTVerifyOptions } from 'jose';
import { readFileSync } from 'node:fs';
import type { KeyObject } from 'node:crypto';
import { OrchestratorError, ErrorCode } from '@orch/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface JwtValidatorOptions {
    /** Path to the PEM-encoded public key file. */
    publicKeyPath: string;
    /** Signing algorithm. */
    algorithm: 'RS256' | 'ES256' | 'EdDSA';
    /** Expected issuer claim. */
    issuer: string;
    /** Expected audience claim. */
    audience: string;
}

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
}

// ─── Implementation ─────────────────────────────────────────────────────────

export class JwtValidator {
    private publicKey: CryptoKey | KeyObject | null = null;
    private readonly options: JwtValidatorOptions;
    private readonly verifyOptions: JWTVerifyOptions;

    constructor(options: JwtValidatorOptions) {
        this.options = options;
        this.verifyOptions = {
            algorithms: [options.algorithm],
            issuer: options.issuer,
            audience: options.audience,
        };
    }

    /**
     * Initialize by loading the public key from disk.
     * Must be called before validate().
     */
    async init(): Promise<void> {
        try {
            const pem = readFileSync(this.options.publicKeyPath, 'utf-8');
            this.publicKey = await importSPKI(pem, this.options.algorithm);
        } catch (err) {
            throw new OrchestratorError(
                ErrorCode.AUTH_FAILED,
                `Failed to load JWT public key: ${err instanceof Error ? err.message : String(err)}`,
                { path: this.options.publicKeyPath },
            );
        }
    }

    /**
     * Validate a JWT token and extract claims.
     *
     * @throws OrchestratorError with TOKEN_EXPIRED or TOKEN_INVALID codes.
     */
    async validate(token: string): Promise<JwtClaims> {
        if (!this.publicKey) {
            throw new OrchestratorError(
                ErrorCode.INTERNAL_ERROR,
                'JwtValidator not initialized. Call init() first.',
            );
        }

        try {
            const { payload } = await jwtVerify(token, this.publicKey, this.verifyOptions);

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
