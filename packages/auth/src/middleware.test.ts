import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuthMiddleware } from './middleware.js';
import type { SessionManager } from './session.js';
import type { PolicyEngine } from './rbac.js';
import type { AuditLogger } from './audit.js';
import { OrchestratorError, ErrorCode } from '@orch/shared';

// Mocks
const mockSessionManager = {
    validate: vi.fn(),
} as unknown as SessionManager;

const mockPolicyEngine = {
    evaluate: vi.fn(),
} as unknown as PolicyEngine;

const mockAuditLogger = {
    log: vi.fn(),
} as unknown as AuditLogger;

describe('createAuthMiddleware', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should extract resource ID from payload and pass to policy engine', async () => {
        const middleware = createAuthMiddleware(mockSessionManager, mockPolicyEngine, mockAuditLogger);

        const context: any = {
            request: {
                topic: 'container',
                action: 'create',
                payload: { name: 'test-container' }, // resource is name for create
                meta: { session_id: 'sess-1', trace_id: 'trace-1' },
            },
            logger: { debug: vi.fn() },
        };

        const session = {
            id: 'sess-1',
            identity: 'user-1',
            roles: ['user'],
        };

        vi.mocked(mockSessionManager.validate).mockReturnValue(session as any);
        vi.mocked(mockPolicyEngine.evaluate).mockReturnValue(true);

        const next = vi.fn();
        await middleware(context, next);

        expect(mockSessionManager.validate).toHaveBeenCalledWith('sess-1');

        // Verify that evaluate is called with the resource
        expect(mockPolicyEngine.evaluate).toHaveBeenCalledWith(
            ['user'],
            'container',
            'create',
            'test-container'
        );

        // Verify that audit log includes the resource
        expect(mockAuditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
            resource: 'test-container',
            outcome: 'allowed',
        }));

        expect(next).toHaveBeenCalled();
    });

    it('should extract resource ID "id" from payload for other actions', async () => {
        const middleware = createAuthMiddleware(mockSessionManager, mockPolicyEngine, mockAuditLogger);

        const context: any = {
            request: {
                topic: 'container',
                action: 'stop',
                payload: { id: 'container-123' }, // resource is id
                meta: { session_id: 'sess-1', trace_id: 'trace-1' },
            },
            logger: { debug: vi.fn() },
        };

        const session = {
            id: 'sess-1',
            identity: 'user-1',
            roles: ['user'],
        };

        vi.mocked(mockSessionManager.validate).mockReturnValue(session as any);
        vi.mocked(mockPolicyEngine.evaluate).mockReturnValue(true);

        const next = vi.fn();
        await middleware(context, next);

        expect(mockPolicyEngine.evaluate).toHaveBeenCalledWith(
            ['user'],
            'container',
            'stop',
            'container-123'
        );
    });

    it('should default to * if resource ID is missing', async () => {
        const middleware = createAuthMiddleware(mockSessionManager, mockPolicyEngine, mockAuditLogger);

        const context: any = {
            request: {
                topic: 'container',
                action: 'list',
                payload: {}, // no resource
                meta: { session_id: 'sess-1', trace_id: 'trace-1' },
            },
            logger: { debug: vi.fn() },
        };

        const session = {
            id: 'sess-1',
            identity: 'user-1',
            roles: ['user'],
        };

        vi.mocked(mockSessionManager.validate).mockReturnValue(session as any);
        vi.mocked(mockPolicyEngine.evaluate).mockReturnValue(true);

        const next = vi.fn();
        await middleware(context, next);

        expect(mockPolicyEngine.evaluate).toHaveBeenCalledWith(
            ['user'],
            'container',
            'list',
            '*'
        );
    });
});
