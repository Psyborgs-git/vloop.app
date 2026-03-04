/**
 * Auth + RBAC middleware for the message router.
 *
 * This middleware:
 * 1. Extracts the session/persistent token from the request meta.
 * 2. Validates via SessionManager or TokenManager (persistent tokens).
 * 3. Evaluates RBAC permissions via PolicyEngine.
 * 4. Logs the mutation to the AuditLogger.
 * 5. Enriches the HandlerContext with identity/roles/sessionId.
 */

import type { Middleware } from '@orch/daemon';
import type { SessionManager } from './session.js';
import type { TokenManager } from './token-manager.js';
import type { PolicyEngine } from './rbac.js';
import type { AuditLogger } from './audit.js';
import { OrchestratorError, ErrorCode } from '@orch/shared';

// Read-only actions that don't require audit logging
const READ_ACTIONS = new Set(['list', 'get', 'inspect', 'info', 'check', 'query']);

function getResourceId(topic: string, action: string, payload: unknown): string {
    const p = (payload || {}) as Record<string, unknown>;

    // 1. Special cases for resources not using 'id' or 'name'
    if (topic === 'container' && action.startsWith('image.')) {
        if (typeof p.image === 'string') return p.image;
    }
    if (topic === 'vault') {
        if (typeof p.path === 'string') return p.path;
    }
    if (topic === 'agent' && action.startsWith('memory.')) {
        if (typeof p.agentId === 'string') return p.agentId;
    }

    // 2. Generic fallback: most resources use 'id' or 'name'
    if (typeof p.id === 'string') return p.id;
    if (typeof p.name === 'string') return p.name;

    // 3. Default wildcard
    return '*';
}

export function createAuthMiddleware(
    sessionManager: SessionManager,
    policyEngine: PolicyEngine,
    auditLogger: AuditLogger,
    tokenManager?: TokenManager,
): Middleware {
    return async (context, next) => {
        const { request, logger, ws } = context;

        // Allow unauthenticated access to auth.login
        if (request.topic === 'auth' && request.action === 'login') {
            return next();
        }

        // ── Step 1: Validate session or persistent token ───────────────────

        // Get session token from connection state (preferred) or request meta (fallback for internal calls)
        let sessionToken = request.meta.session_id;
        
        if (ws) {
            // @ts-ignore - we attach sessionId to the ws object during login
            const wsSessionId = ws.sessionId;
            if (wsSessionId) {
                sessionToken = wsSessionId;
            }
        }

        if (!sessionToken) {
            throw new OrchestratorError(
                ErrorCode.AUTH_REQUIRED,
                'Authentication required. Please login first.',
            );
        }

        let identity: string;
        let roles: string[];
        let sessionId: string;

        // Try persistent token first (prefixed with orch_), then session
        if (tokenManager && sessionToken.startsWith('orch_')) {
            const validated = tokenManager.validate(sessionToken);
            identity = validated.identity;
            roles = validated.roles;
            sessionId = validated.id;
        } else {
            const session = sessionManager.validate(sessionToken);
            identity = session.identity;
            roles = session.roles;
            sessionId = session.id;
        }

        // Enrich context
        context.identity = identity;
        context.roles = roles;
        context.sessionId = sessionId;

        logger.debug(
            { identity, roles },
            'Session validated',
        );

        // ── Step 2: Evaluate RBAC ──────────────────────────────────────────

        const resource = getResourceId(request.topic, request.action, request.payload);

        const isAllowed = policyEngine.evaluate(
            roles,
            request.topic,
            request.action,
            resource,
        );

        // ── Step 3: Audit log (mutations only) ─────────────────────────────

        const isMutation = !READ_ACTIONS.has(request.action);
        if (isMutation || !isAllowed) {
            auditLogger.log({
                sessionId,
                identity,
                topic: request.topic,
                action: request.action,
                resource,
                outcome: isAllowed ? 'allowed' : 'denied',
                traceId: request.meta.trace_id,
            });
        }

        // ── Step 4: Enforce ────────────────────────────────────────────────

        if (!isAllowed) {
            throw new OrchestratorError(
                ErrorCode.PERMISSION_DENIED,
                `Permission denied: ${identity} lacks ${request.topic}:${request.action}:${resource}`,
                {
                    identity,
                    roles,
                    required: `${request.topic}:${request.action}:${resource}`,
                },
            );
        }

        // ── Step 5: Continue to handler ────────────────────────────────────

        return next();
    };
}
