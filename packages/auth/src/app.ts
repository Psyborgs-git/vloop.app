import type { DependencyContainer } from "tsyringe";
import type { AppConfig } from "@orch/shared";
import { TOKENS, resolveConfig } from "@orch/shared";

import { UserManager } from "./user.js";
import { JwtProviderManager } from "./jwt-provider.js";
import { JwtValidator } from "./jwt.js";
import { SessionManager } from "./session.js";
import { PolicyEngine } from "./rbac.js";
import { AuditLogger } from "./audit.js";

const config: AppConfig = {
    name: "@orch/auth",
    register(container: DependencyContainer) {
        // Register Managers using factory to resolve primitive tokens
        container.register(UserManager, {
            useFactory: (c) => new UserManager(c.resolve(TOKENS.Database), c.resolve(TOKENS.DatabaseOrm))
        });
        container.register(JwtProviderManager, {
            useFactory: (c) => new JwtProviderManager(c.resolve(TOKENS.Database), c.resolve(TOKENS.DatabaseOrm))
        });
        container.register(JwtValidator, {
            useFactory: (c) => new JwtValidator(c.resolve(JwtProviderManager))
        });
        container.register(SessionManager, {
            useFactory: (c) => {
                const { session_idle_timeout_secs, session_max_lifetime_secs, max_sessions_per_identity } =
                    resolveConfig(c, 'auth');
                return new SessionManager(c.resolve(TOKENS.Database), c.resolve(TOKENS.DatabaseOrm), {
                    idleTimeoutSecs: session_idle_timeout_secs,
                    maxLifetimeSecs: session_max_lifetime_secs,
                    maxSessionsPerIdentity: max_sessions_per_identity,
                });
            }
        });
        // PolicyEngine is completely independent initially
        container.registerSingleton(PolicyEngine);
        container.register(AuditLogger, {
            useFactory: (c) => new AuditLogger(c.resolve(TOKENS.Database), c.resolve(TOKENS.DatabaseOrm))
        });
    },
    async init(container: DependencyContainer) {
        // Run async initialization
        const userManager = container.resolve(UserManager);
        await userManager.initDefaultUser();
        
        const policyEngine = container.resolve(PolicyEngine);
        // Load policy right away. We need config or we can just load from default path.
        // Wait, Orchestrator App uses: `resolve("./config/policies.toml")`
        // We can just hardcode or read from config if it had one, but let's hardcode for now as app.ts did.
        policyEngine.load("./config/policies.toml");
    }
};

export default config;
