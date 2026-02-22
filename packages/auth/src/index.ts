/**
 * @orch/auth — Authentication, session management, RBAC, and audit.
 */

export { JwtValidator } from './jwt.js';
export type { JwtValidatorOptions, JwtClaims } from './jwt.js';

export { SessionManager } from './session.js';
export type { Session, SessionManagerOptions } from './session.js';

export { PolicyEngine } from './rbac.js';
export type { RbacPolicy, RoleDefinition } from './rbac.js';

export { AuditLogger } from './audit.js';
export type { AuditEntry } from './audit.js';

export { createAuthMiddleware } from './middleware.js';
