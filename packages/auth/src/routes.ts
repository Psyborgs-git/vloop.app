import type { DependencyContainer } from "tsyringe";
import { createAuthHandler, createAuthMiddleware } from "./index.js";
import { SessionManager } from "./session.js";
import { UserManager } from "./user.js";
import { JwtValidator } from "./jwt.js";
import { JwtProviderManager } from "./jwt-provider.js";
import { PolicyEngine } from "./rbac.js";
import { AuditLogger } from "./audit.js";

export function registerRoutes(container: DependencyContainer, router: any) {
    const sessionManager = container.resolve(SessionManager);
    const userManager = container.resolve(UserManager);
    const jwtValidator = container.resolve(JwtValidator);
    const jwtProviderManager = container.resolve(JwtProviderManager);
    const policyEngine = container.resolve(PolicyEngine);
    const auditLogger = container.resolve(AuditLogger);

    // Apply global auth middleware
    router.use(createAuthMiddleware(sessionManager, policyEngine, auditLogger));

    // Register handlers
    router.register("auth", createAuthHandler(sessionManager, userManager, jwtValidator, jwtProviderManager));
}
