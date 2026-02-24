/**
 * @orch/auth — Authentication, session management, RBAC, and audit.
 */

export { JwtValidator } from './jwt.js';
export type { JwtClaims } from './jwt.js';

export { SessionManager } from './session.js';
export type { Session, SessionManagerOptions } from './session.js';

export { PolicyEngine } from './rbac.js';
export type { RbacPolicy, RoleDefinition } from './rbac.js';

export { AuditLogger } from './audit.js';
export type { AuditEntry } from './audit.js';

export { createAuthMiddleware } from './middleware.js';

export { UserManager } from './user.js';
export type { User } from './user.js';

export { JwtProviderManager } from './jwt-provider.js';
export type { JwtProvider } from './jwt-provider.js';

export { createAuthHandler } from './handler.js';
