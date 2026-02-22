/**
 * Auth + RBAC middleware for the message router.
 *
 * This middleware:
 * 1. Extracts the session token from the request meta.
 * 2. Validates the session via SessionManager.
 * 3. Evaluates RBAC permissions via PolicyEngine.
 * 4. Logs the mutation to the AuditLogger.
 * 5. Enriches the HandlerContext with identity/roles/sessionId.
 */

import type { Middleware } from '@orch/daemon';
import type { SessionManager } from './session.js';
import type { PolicyEngine } from './rbac.js';
import type { AuditLogger } from './audit.js';
import { OrchestratorError, ErrorCode } from '@orch/shared';

// Read-only actions that don't require audit logging
const READ_ACTIONS = new Set(['list', 'get', 'inspect', 'info', 'check', 'query']);

export function createAuthMiddleware(
    sessionManager: SessionManager,
    policyEngine: PolicyEngine,
    auditLogger: AuditLogger,
): Middleware {
    return async (context, next) => {
        const { request, logger } = context;
        const sessionToken = request.meta.session_id;

        // ── Step 1: Validate session ───────────────────────────────────────

        if (!sessionToken) {
            throw new OrchestratorError(
                ErrorCode.AUTH_REQUIRED,
                'Missing session_id in request meta. Authenticate first.',
            );
        }

        const session = sessionManager.validate(sessionToken);

        // Enrich context
        context.identity = session.identity;
        context.roles = session.roles;
        context.sessionId = session.id;

        logger.debug(
            { identity: session.identity, roles: session.roles },
            'Session validated',
        );

        // ── Step 2: Evaluate RBAC ──────────────────────────────────────────

        const isAllowed = policyEngine.evaluate(
            session.roles,
            request.topic,
            request.action,
        );

        // ── Step 3: Audit log (mutations only) ─────────────────────────────

        const isMutation = !READ_ACTIONS.has(request.action);
        if (isMutation || !isAllowed) {
            auditLogger.log({
                sessionId: session.id,
                identity: session.identity,
                topic: request.topic,
                action: request.action,
                outcome: isAllowed ? 'allowed' : 'denied',
                traceId: request.meta.trace_id,
            });
        }

        // ── Step 4: Enforce ────────────────────────────────────────────────

        if (!isAllowed) {
            throw new OrchestratorError(
                ErrorCode.PERMISSION_DENIED,
                `Permission denied: ${session.identity} lacks ${request.topic}:${request.action}`,
                {
                    identity: session.identity,
                    roles: session.roles,
                    required: `${request.topic}:${request.action}:*`,
                },
            );
        }

        // ── Step 5: Continue to handler ────────────────────────────────────

        return next();
    };
}
