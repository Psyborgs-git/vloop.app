/**
 * Tests for @orch/auth/rbac — RBAC policy engine
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { PolicyEngine } from './rbac.js';

describe('PolicyEngine', () => {
    let tempDir: string;
    let policyPath: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'orch-rbac-test-'));
        policyPath = join(tempDir, 'policies.toml');

        writeFileSync(policyPath, `
[roles.admin]
description = "Full access"
permissions = ["*:*:*"]

[roles.operator]
description = "Manage containers"
permissions = [
  "container:*:*",
  "process:*:*",
  "health:*:*",
]

[roles.agent]
description = "AI agent"
permissions = [
  "container:create:agent-*",
  "container:stop:agent-*",
  "vault:secret.get:agent-*",
]

[roles.viewer]
description = "Read-only"
permissions = [
  "container:list:*",
  "container:inspect:*",
  "health:check:*",
]
`);
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('should load policies from TOML', async () => {
        const engine = new PolicyEngine();
        await engine.load(policyPath);
        expect(engine.roleNames().sort()).toEqual(['admin', 'agent', 'operator', 'viewer']);
    });

    it('should grant admin all permissions', async () => {
        const engine = new PolicyEngine();
        await engine.load(policyPath);

        expect(engine.evaluate(['admin'], 'container', 'create', 'my-container')).toBe(true);
        expect(engine.evaluate(['admin'], 'vault', 'secret.delete', 'anything')).toBe(true);
        expect(engine.evaluate(['admin'], 'any-topic', 'any-action', 'any-resource')).toBe(true);
    });

    it('should allow operator to manage containers', async () => {
        const engine = new PolicyEngine();
        await engine.load(policyPath);

        expect(engine.evaluate(['operator'], 'container', 'create', 'foo')).toBe(true);
        expect(engine.evaluate(['operator'], 'container', 'stop', 'foo')).toBe(true);
        expect(engine.evaluate(['operator'], 'process', 'list', 'bar')).toBe(true);
    });

    it('should deny operator vault access', async () => {
        const engine = new PolicyEngine();
        await engine.load(policyPath);

        expect(engine.evaluate(['operator'], 'vault', 'secret.get', 'my-secret')).toBe(false);
    });

    it('should allow agent scoped container access', async () => {
        const engine = new PolicyEngine();
        await engine.load(policyPath);

        expect(engine.evaluate(['agent'], 'container', 'create', 'agent-llm-1')).toBe(true);
        expect(engine.evaluate(['agent'], 'container', 'stop', 'agent-test')).toBe(true);
        expect(engine.evaluate(['agent'], 'vault', 'secret.get', 'agent-config')).toBe(true);
    });

    it('should deny agent access to non-agent resources', async () => {
        const engine = new PolicyEngine();
        await engine.load(policyPath);

        expect(engine.evaluate(['agent'], 'container', 'create', 'production-db')).toBe(false);
        expect(engine.evaluate(['agent'], 'vault', 'secret.get', 'admin-key')).toBe(false);
    });

    it('should allow viewer read-only access', async () => {
        const engine = new PolicyEngine();
        await engine.load(policyPath);

        expect(engine.evaluate(['viewer'], 'container', 'list', 'anything')).toBe(true);
        expect(engine.evaluate(['viewer'], 'container', 'inspect', 'foo')).toBe(true);
        expect(engine.evaluate(['viewer'], 'health', 'check', 'all')).toBe(true);
    });

    it('should deny viewer write access', async () => {
        const engine = new PolicyEngine();
        await engine.load(policyPath);

        expect(engine.evaluate(['viewer'], 'container', 'create', 'foo')).toBe(false);
        expect(engine.evaluate(['viewer'], 'container', 'stop', 'foo')).toBe(false);
    });

    it('should enforce and throw on denied permission', async () => {
        const engine = new PolicyEngine();
        await engine.load(policyPath);

        expect(() => engine.enforce(['viewer'], 'container', 'create')).toThrow('Permission denied');
    });

    it('should not throw for allowed permission on enforce', async () => {
        const engine = new PolicyEngine();
        await engine.load(policyPath);

        expect(() => engine.enforce(['admin'], 'container', 'create')).not.toThrow();
    });

    it('should evaluate multiple roles (union)', async () => {
        const engine = new PolicyEngine();
        await engine.load(policyPath);

        // viewer alone can't create, but viewer+operator can
        expect(engine.evaluate(['viewer'], 'container', 'create', 'foo')).toBe(false);
        expect(engine.evaluate(['viewer', 'operator'], 'container', 'create', 'foo')).toBe(true);
    });

    it('should support reload', async () => {
        const engine = new PolicyEngine();
        await engine.load(policyPath);
        expect(engine.roleNames().length).toBe(4);

        // Write new policies
        const newPath = join(tempDir, 'new.toml');
        writeFileSync(newPath, `
[roles.superadmin]
description = "Super"
permissions = ["*:*:*"]
`);

        await engine.reload(newPath);
        expect(engine.roleNames()).toEqual(['superadmin']);
    });
});
