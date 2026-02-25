import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { JwtValidator } from './jwt.js';
import { JwtProviderManager } from './jwt-provider.js';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import * as jose from 'jose';

// Mock dependencies
vi.mock('./jwt-provider.js');
vi.mock('jose');

describe('JwtValidator', () => {
    let validator: JwtValidator;
    let mockProviderManager: JwtProviderManager;

    const mockProvider = {
        id: 'provider-1',
        issuer: 'https://auth.example.com',
        jwks_url: 'https://auth.example.com/.well-known/jwks.json',
        audience: 'my-audience',
        created_at: '2023-01-01T00:00:00Z',
    };

    const validToken = 'valid.token.string';

    beforeEach(() => {
        vi.clearAllMocks();

        // Setup mock provider manager
        // Since the class is mocked, we can instantiate it freely
        mockProviderManager = new JwtProviderManager({} as any);
        // Ensure method is a spy
        mockProviderManager.findByIssuer = vi.fn();

        validator = new JwtValidator(mockProviderManager);
    });

    it('should validate a valid token and return claims', async () => {
        // 1. Mock decodeJwt to return issuer
        vi.mocked(jose.decodeJwt).mockReturnValue({ iss: mockProvider.issuer });

        // 2. Mock findByIssuer to return provider
        vi.mocked(mockProviderManager.findByIssuer).mockReturnValue(mockProvider);

        // 3. Mock createRemoteJWKSet
        const mockJWKS = vi.fn();
        vi.mocked(jose.createRemoteJWKSet).mockReturnValue(mockJWKS as any);

        // 4. Mock jwtVerify to return payload
        const expectedPayload = {
            sub: 'user-123',
            roles: ['admin', 'editor'],
            scope: 'read write',
            exp: 1700000000,
            iat: 1600000000,
            iss: mockProvider.issuer,
        };
        vi.mocked(jose.jwtVerify).mockResolvedValue({
            payload: expectedPayload,
            protectedHeader: { alg: 'RS256' },
        });

        const result = await validator.validate(validToken);

        expect(jose.decodeJwt).toHaveBeenCalledWith(validToken);
        expect(mockProviderManager.findByIssuer).toHaveBeenCalledWith(mockProvider.issuer);
        expect(jose.createRemoteJWKSet).toHaveBeenCalledWith(new URL(mockProvider.jwks_url));
        expect(jose.jwtVerify).toHaveBeenCalledWith(validToken, mockJWKS, {
            issuer: mockProvider.issuer,
            audience: mockProvider.audience,
        });

        expect(result).toEqual({
            sub: 'user-123',
            roles: ['admin', 'editor'],
            scope: 'read write',
            exp: 1700000000,
            iat: 1600000000,
            iss: mockProvider.issuer,
        });
    });

    it('should throw TOKEN_INVALID if issuer is missing in token', async () => {
        vi.mocked(jose.decodeJwt).mockReturnValue({}); // No iss

        await expect(validator.validate(validToken)).rejects.toThrow(OrchestratorError);
        await expect(validator.validate(validToken)).rejects.toThrow('JWT missing required "iss" claim');

        try {
            await validator.validate(validToken);
        } catch (err: any) {
            expect(err.code).toBe(ErrorCode.TOKEN_INVALID);
        }
    });

    it('should throw AUTH_FAILED if provider is not found', async () => {
        vi.mocked(jose.decodeJwt).mockReturnValue({ iss: 'unknown-issuer' });
        vi.mocked(mockProviderManager.findByIssuer).mockReturnValue(undefined);

        await expect(validator.validate(validToken)).rejects.toThrow(OrchestratorError);
        await expect(validator.validate(validToken)).rejects.toThrow('is not a registered provider');

        try {
            await validator.validate(validToken);
        } catch (err: any) {
            expect(err.code).toBe(ErrorCode.AUTH_FAILED);
        }
    });

    it('should cache JWKS for the same issuer', async () => {
        vi.mocked(jose.decodeJwt).mockReturnValue({ iss: mockProvider.issuer });
        vi.mocked(mockProviderManager.findByIssuer).mockReturnValue(mockProvider);

        const mockJWKS = vi.fn();
        vi.mocked(jose.createRemoteJWKSet).mockReturnValue(mockJWKS as any);

        vi.mocked(jose.jwtVerify).mockResolvedValue({
            payload: { sub: 'user' },
            protectedHeader: { alg: 'RS256' },
        });

        // First call
        await validator.validate(validToken);
        // Second call
        await validator.validate(validToken);

        expect(jose.createRemoteJWKSet).toHaveBeenCalledTimes(1);
    });

    it('should throw TOKEN_INVALID if sub claim is missing', async () => {
        vi.mocked(jose.decodeJwt).mockReturnValue({ iss: mockProvider.issuer });
        vi.mocked(mockProviderManager.findByIssuer).mockReturnValue(mockProvider);
        vi.mocked(jose.jwtVerify).mockResolvedValue({
            payload: { iss: mockProvider.issuer }, // Missing sub
            protectedHeader: { alg: 'RS256' },
        });

        await expect(validator.validate(validToken)).rejects.toThrow(OrchestratorError);
        await expect(validator.validate(validToken)).rejects.toThrow('JWT missing required "sub" claim');
    });

    it('should parse comma-separated roles string', async () => {
        vi.mocked(jose.decodeJwt).mockReturnValue({ iss: mockProvider.issuer });
        vi.mocked(mockProviderManager.findByIssuer).mockReturnValue(mockProvider);
        vi.mocked(jose.jwtVerify).mockResolvedValue({
            payload: { sub: 'user', roles: 'role1, role2 ' },
            protectedHeader: { alg: 'RS256' },
        });

        const result = await validator.validate(validToken);
        expect(result.roles).toEqual(['role1', 'role2']);
    });

    it('should handle missing roles gracefully', async () => {
        vi.mocked(jose.decodeJwt).mockReturnValue({ iss: mockProvider.issuer });
        vi.mocked(mockProviderManager.findByIssuer).mockReturnValue(mockProvider);
        vi.mocked(jose.jwtVerify).mockResolvedValue({
            payload: { sub: 'user' }, // No roles
            protectedHeader: { alg: 'RS256' },
        });

        const result = await validator.validate(validToken);
        expect(result.roles).toEqual([]);
    });

    it('should throw TOKEN_EXPIRED if token is expired', async () => {
        vi.mocked(jose.decodeJwt).mockReturnValue({ iss: mockProvider.issuer });
        vi.mocked(mockProviderManager.findByIssuer).mockReturnValue(mockProvider);

        const error = new Error('token expired');
        vi.mocked(jose.jwtVerify).mockRejectedValue(error);

        try {
            await validator.validate(validToken);
            throw new Error('Should have thrown');
        } catch (err: any) {
            expect(err).toBeInstanceOf(OrchestratorError);
            expect(err.code).toBe(ErrorCode.TOKEN_EXPIRED);
            expect(err.message).toBe('JWT has expired.');
        }
    });

    it('should throw TOKEN_INVALID for other validation errors', async () => {
        vi.mocked(jose.decodeJwt).mockReturnValue({ iss: mockProvider.issuer });
        vi.mocked(mockProviderManager.findByIssuer).mockReturnValue(mockProvider);

        const error = new Error('signature verification failed');
        vi.mocked(jose.jwtVerify).mockRejectedValue(error);

        try {
            await validator.validate(validToken);
            throw new Error('Should have thrown');
        } catch (err: any) {
            expect(err).toBeInstanceOf(OrchestratorError);
            expect(err.code).toBe(ErrorCode.TOKEN_INVALID);
            expect(err.message).toContain('JWT validation failed');
        }
    });

    it('should rethrow OrchestratorError if thrown inside try block', async () => {
         // Force decodeJwt to throw OrchestratorError (e.g. somehow)
         // Or easier: make jwtVerify throw one
         const orchError = new OrchestratorError(ErrorCode.INTERNAL_ERROR, 'Internal error');
         vi.mocked(jose.decodeJwt).mockReturnValue({ iss: mockProvider.issuer });
         vi.mocked(mockProviderManager.findByIssuer).mockReturnValue(mockProvider);
         vi.mocked(jose.jwtVerify).mockRejectedValue(orchError);

         await expect(validator.validate(validToken)).rejects.toThrow(orchError);
    });
});
