
import { describe, it, expect, vi } from 'vitest';
import { PolicyEngine } from './rbac.js';

// Mock dependencies
vi.mock('node:fs/promises', () => ({
    readFile: vi.fn().mockResolvedValue(`
[roles.admin]
description = "Admin"
permissions = ["*:*:*"]
`)
}));

vi.mock('smol-toml', () => ({
    parse: vi.fn().mockReturnValue({
        roles: {
            admin: {
                description: "Admin",
                permissions: ["*:*:*"]
            }
        }
    })
}));

vi.mock('minimatch', () => ({
    minimatch: vi.fn().mockReturnValue(true)
}));

// Mock @orch/shared since it's a workspace package
vi.mock('@orch/shared', () => ({
    OrchestratorError: class extends Error {
        constructor(public code: string, message: string, public context?: any) {
            super(message);
        }
    },
    ErrorCode: {
        CONFIG_INVALID: 'CONFIG_INVALID',
        PERMISSION_DENIED: 'PERMISSION_DENIED'
    }
}));

describe('PolicyEngine Async Verification', () => {
    it('load should be async and return a promise', async () => {
        const engine = new PolicyEngine();
        const result = engine.load('dummy.toml');

        expect(result).toBeInstanceOf(Promise);
        await expect(result).resolves.not.toThrow();

        // Verify it loaded the mocked policy
        expect(engine.roleNames()).toEqual(['admin']);
    });

    it('reload should be async', async () => {
        const engine = new PolicyEngine();
        const result = engine.reload('dummy.toml');

        expect(result).toBeInstanceOf(Promise);
        await expect(result).resolves.not.toThrow();
    });
});
