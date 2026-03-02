/**
 * Integration test: Auth middleware pipeline.
 *
 * Exercises the full flow: Session → RBAC → Audit → Handler,
 * wired together through the Router.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3-multiple-ciphers';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { Router } from '../../packages/daemon/src/router.js';
import { createLogger } from '../../packages/daemon/src/logging.js';
import type { HandlerContext } from '../../packages/daemon/src/router.js';
import { SessionManager } from '../../packages/auth/src/session.js';
import { PolicyEngine } from '../../packages/auth/src/rbac.js';
import { AuditLogger } from '../../packages/auth/src/audit.js';
import { UserManager } from '../../packages/auth/src/user.js';
import { createAuthMiddleware } from '../../packages/auth/src/middleware.js';

const logger = createLogger('error');

function makeRequest(
    topic: string,
    action: string,
    sessionToken?: string,
    payload: unknown = {},
) {
    return {
        id: `req-${Date.now()}`,
        topic,
        action,
        payload,
        meta: {
            timestamp: new Date().toISOString(),
            trace_id: `trace-${Date.now()}`,
            session_id: sessionToken,
        },
    };
}

describe('Auth Middleware Pipeline', () => {
    let tempDir: string;
    let db: InstanceType<typeof Database>;
    let orm: ReturnType<typeof drizzle>;
    let sessionManager: SessionManager;
    let policyEngine: PolicyEngine;
    let auditLogger: AuditLogger;
    let userManager: UserManager;
    let router: Router;
    let policyPath: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'orch-auth-integ-'));
        db = new Database(join(tempDir, 'test.db'));
        orm = drizzle(db);

        // Session manager
        sessionManager = new SessionManager(db, orm, {
            idleTimeoutSecs: 3600,
            maxLifetimeSecs: 86400,
            maxSessionsPerIdentity: 10,
        });

        // User manager
        userManager = new UserManager(db, orm);

        // RBAC policies
        policyPath = join(tempDir, 'policies.toml');
        writeFileSync(policyPath, `
[roles.admin]
description = "Full access"
permissions = ["*:*:*"]

[roles.viewer]
description = "Read-only"
permissions = [
  "vault:secret.get:*",
  "vault:secret.list:*",
  "health:check:*",
]
`);
        policyEngine = new PolicyEngine();
        policyEngine.load(policyPath);

        // Audit logger
        auditLogger = new AuditLogger(db, orm);

        // Setup router with auth middleware
        router = new Router(logger);
        const authMiddleware = createAuthMiddleware(sessionManager, policyEngine, auditLogger);
        router.use(authMiddleware);

        // Register a test handler
        router.register('vault', (action: string, payload: unknown, context: HandlerContext) => {
            return {
                action,
                received: payload,
                identity: context.identity,
                roles: context.roles,
            };
        });

        router.register('health', () => {
            return { status: 'healthy' };
        });

        // Register a mock auth handler for user.create
        router.register('auth', (action: string, payload: unknown) => {
            if (action === 'user.create') {
                return { success: true, created: payload };
            }
            throw new Error('Unknown action');
        });
    });

    afterEach(() => {
        db.close();
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('should reject request without session token', async () => {
        const req = makeRequest('vault', 'secret.get');
        const resp = await router.dispatch(req, logger);

        expect(resp.type).toBe('error');
        const payload = resp.payload as Record<string, unknown>;
        expect(payload.code).toBe('AUTH_REQUIRED');
    });

    it('should reject request with invalid session token', async () => {
        const req = makeRequest('vault', 'secret.get', 'invalid-token-123');
        const resp = await router.dispatch(req, logger);

        expect(resp.type).toBe('error');
        const payload = resp.payload as Record<string, unknown>;
        // Should be SESSION_NOT_FOUND or similar auth error
        expect(['SESSION_NOT_FOUND', 'AUTH_FAILED', 'INTERNAL_ERROR', 'SESSION_REVOKED']).toContain(payload.code);
    });

    it('should allow admin to access vault', async () => {
        const { token } = sessionManager.create('admin@test.com', ['admin']);
        const req = makeRequest('vault', 'secret.create', token, { name: 'test' });
        const resp = await router.dispatch(req, logger);

        expect(resp.type).toBe('result');
        const payload = resp.payload as Record<string, unknown>;
        expect(payload.identity).toBe('admin@test.com');
        expect(payload.roles).toEqual(['admin']);
        expect(payload.action).toBe('secret.create');
    });

    it('should allow viewer to read vault secrets', async () => {
        const { token } = sessionManager.create('viewer@test.com', ['viewer']);
        const req = makeRequest('vault', 'secret.get', token, { name: 'api-key' });
        const resp = await router.dispatch(req, logger);

        expect(resp.type).toBe('result');
        const payload = resp.payload as Record<string, unknown>;
        expect(payload.identity).toBe('viewer@test.com');
    });

    it('should deny viewer write access to vault', async () => {
        const { token } = sessionManager.create('viewer@test.com', ['viewer']);
        const req = makeRequest('vault', 'secret.create', token, { name: 'new-secret' });
        const resp = await router.dispatch(req, logger);

        expect(resp.type).toBe('error');
        const payload = resp.payload as Record<string, unknown>;
        expect(payload.code).toBe('PERMISSION_DENIED');
    });

    it('should create audit entries for mutations', async () => {
        const { token } = sessionManager.create('admin@test.com', ['admin']);

        // Mutation action (should be audited)
        const req = makeRequest('vault', 'secret.create', token, { name: 'secret' });
        await router.dispatch(req, logger);

        const { items: entries } = auditLogger.query({ identity: 'admin@test.com' });
        expect(entries.length).toBeGreaterThanOrEqual(1);
        expect(entries.some((e: { action: string; outcome: string }) =>
            e.action === 'secret.create' && e.outcome === 'allowed',
        )).toBe(true);
    });

    it('should audit denied access attempts', async () => {
        const { token } = sessionManager.create('viewer@test.com', ['viewer']);

        const req = makeRequest('vault', 'secret.delete', token);
        await router.dispatch(req, logger);

        const { items: entries } = auditLogger.query({ identity: 'viewer@test.com', outcome: 'denied' });
        expect(entries.length).toBeGreaterThanOrEqual(1);
        expect(entries[0]!.action).toBe('secret.delete');
    });

    it('should enrich handler context with session info', async () => {
        const { token } = sessionManager.create('operator@test.com', ['admin']);
        const req = makeRequest('vault', 'secret.get', token, { key: 'val' });
        const resp = await router.dispatch(req, logger);

        expect(resp.type).toBe('result');
        const payload = resp.payload as Record<string, unknown>;
        expect(payload.identity).toBe('operator@test.com');
        expect(payload.roles).toEqual(['admin']);
        expect(payload.received).toEqual({ key: 'val' });
    });

    it('should reject request after session is revoked', async () => {
        const { session, token } = sessionManager.create('temp@test.com', ['admin']);

        // First request should work
        const req1 = makeRequest('health', 'check', token);
        const resp1 = await router.dispatch(req1, logger);
        expect(resp1.type).toBe('result');

        // Revoke session
        sessionManager.revoke(session.id);

        // Second request should fail
        const req2 = makeRequest('health', 'check', token);
        const resp2 = await router.dispatch(req2, logger);
        expect(resp2.type).toBe('error');
    });

    it('should initialize default admin user if db is empty', async () => {
        expect(userManager.count()).toBe(0);
        await userManager.initDefaultUser();
        expect(userManager.count()).toBe(1);
        
        const user = userManager.findByEmail('admin');
        expect(user).toBeDefined();
        expect(user?.email).toBe('admin');
        expect(JSON.parse(user?.allowed_roles || '[]')).toEqual(['admin']);
        
        // Should be able to verify password
        const verified = await userManager.verifyPassword('admin', 'password');
        expect(verified.email).toBe('admin');
    });
});
