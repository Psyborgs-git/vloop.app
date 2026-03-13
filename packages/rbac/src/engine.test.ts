import { describe, it, expect } from 'vitest';
import { PolicyEngine } from './engine.js';

describe('PolicyEngine', () => {
    // ── Default roles ────────────────────────────────────────────────────

    describe('default roles', () => {
        const engine = new PolicyEngine();

        it('guest can ai:chat', () => {
            expect(engine.evaluate(['guest'], 'ai', 'chat')).toBe(true);
        });

        it('guest cannot terminal:exec', () => {
            expect(engine.evaluate(['guest'], 'terminal', 'exec')).toBe(false);
        });

        it('guest cannot vault:read', () => {
            expect(engine.evaluate(['guest'], 'vault', 'read')).toBe(false);
        });

        it('developer can terminal:exec', () => {
            expect(engine.evaluate(['developer'], 'terminal', 'exec')).toBe(true);
        });

        it('developer can ai:chat and ai:anything (wildcard)', () => {
            expect(engine.evaluate(['developer'], 'ai', 'chat')).toBe(true);
            expect(engine.evaluate(['developer'], 'ai', 'summarize')).toBe(true);
        });

        it('developer cannot vault:admin (deny)', () => {
            expect(engine.evaluate(['developer'], 'vault', 'admin')).toBe(false);
        });

        it('admin can do anything', () => {
            expect(engine.evaluate(['admin'], 'terminal', 'exec')).toBe(true);
            expect(engine.evaluate(['admin'], 'vault', 'admin')).toBe(true);
            expect(engine.evaluate(['admin'], 'fs', 'write')).toBe(true);
        });
    });

    // ── Deny-wins ────────────────────────────────────────────────────────

    describe('deny-wins model', () => {
        it('deny from first role blocks even if second role allows', () => {
            const engine = new PolicyEngine({
                roles: {
                    restricted: {
                        permissions: [],
                        deny: ['vault:*'],
                    },
                    elevated: {
                        permissions: ['vault:read'],
                        deny: [],
                    },
                },
            });
            // restricted's deny matches vault:read → blocked before elevated is checked
            expect(engine.evaluate(['restricted', 'elevated'], 'vault', 'read')).toBe(false);
        });
    });

    // ── Unknown roles ────────────────────────────────────────────────────

    describe('unknown roles', () => {
        it('unknown role denies all', () => {
            const engine = new PolicyEngine();
            expect(engine.evaluate(['unknown'], 'ai', 'chat')).toBe(false);
        });

        it('empty roles denies all', () => {
            const engine = new PolicyEngine();
            expect(engine.evaluate([], 'ai', 'chat')).toBe(false);
        });
    });

    // ── Role management ─────────────────────────────────────────────────

    describe('role management', () => {
        it('setRole and getRole', () => {
            const engine = new PolicyEngine();
            engine.setRole('tester', { permissions: ['test:run'], deny: [] });
            expect(engine.getRole('tester')).toEqual({ permissions: ['test:run'], deny: [] });
            expect(engine.evaluate(['tester'], 'test', 'run')).toBe(true);
        });

        it('removeRole', () => {
            const engine = new PolicyEngine();
            engine.setRole('temp', { permissions: ['temp:action'], deny: [] });
            engine.removeRole('temp');
            expect(engine.getRole('temp')).toBeUndefined();
            expect(engine.evaluate(['temp'], 'temp', 'action')).toBe(false);
        });

        it('loadRoles replaces all', () => {
            const engine = new PolicyEngine();
            engine.loadRoles({
                viewer: { permissions: ['view:*'], deny: [] },
            });
            expect(engine.roleNames()).toEqual(['viewer']);
            expect(engine.evaluate(['admin'], 'anything', 'anywhere')).toBe(false);
        });
    });

    // ── Extension roles ─────────────────────────────────────────────────

    describe('extensions', () => {
        it('isExtensionRole detects extension: prefix', () => {
            expect(PolicyEngine.isExtensionRole('extension:my-plugin')).toBe(true);
            expect(PolicyEngine.isExtensionRole('admin')).toBe(false);
        });

        it('registerExtension creates scoped role', () => {
            const engine = new PolicyEngine();
            engine.registerExtension('my-plugin', ['ai:chat', 'fs:read']);
            expect(engine.evaluate(['extension:my-plugin'], 'ai', 'chat')).toBe(true);
            expect(engine.evaluate(['extension:my-plugin'], 'fs', 'read')).toBe(true);
            expect(engine.evaluate(['extension:my-plugin'], 'terminal', 'exec')).toBe(false);
        });

        it('registerExtension rejects wildcards', () => {
            const engine = new PolicyEngine();
            expect(() => engine.registerExtension('bad', ['*'])).toThrow('wildcard');
            expect(() => engine.registerExtension('bad', ['ai:*'])).toThrow('wildcard');
        });
    });

    // ── Enforce ─────────────────────────────────────────────────────────

    describe('enforce', () => {
        it('does not throw when allowed', () => {
            const engine = new PolicyEngine();
            expect(() => engine.enforce(['admin'], 'vault', 'read')).not.toThrow();
        });

        it('throws when denied', () => {
            const engine = new PolicyEngine();
            expect(() => engine.enforce(['guest'], 'terminal', 'exec')).toThrow('RBAC denied');
        });
    });
});
