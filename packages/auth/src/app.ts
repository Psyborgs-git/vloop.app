import type { DependencyContainer } from "tsyringe";
import type { AppComponent, AppComponentContext } from "@orch/shared";
import { TOKENS, resolveConfig } from "@orch/shared";

import { UserManager } from "./user.js";
import { JwtProviderManager } from "./jwt-provider.js";
import { JwtValidator } from "./jwt.js";
import { SessionManager } from "./session.js";
import { PolicyEngine } from "./rbac.js";
import { AuditLogger } from "./audit.js";
import { TokenManager } from "./token-manager.js";

const config: AppComponent = {
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
        // Also register under shared token for cross-package resolution
        container.register(TOKENS.SessionManager, {
            useFactory: (c) => c.resolve(SessionManager)
        });
        // PolicyEngine is completely independent initially
        container.registerSingleton(PolicyEngine);
        container.register(AuditLogger, {
            useFactory: (c) => new AuditLogger(c.resolve(TOKENS.Database), c.resolve(TOKENS.DatabaseOrm))
        });
        container.register(TokenManager, {
            useFactory: (c) => new TokenManager(c.resolve(TOKENS.DatabaseOrm), {
                maxTokensPerIdentity: 50,
            })
        });
        container.register(TOKENS.TokenManager, {
            useFactory: (c) => c.resolve(TokenManager)
        });
    },
    async init({ container }: AppComponentContext) {
        // Initialize token schema
        const tokenManager = container.resolve(TokenManager);
        tokenManager.initSchema(container.resolve(TOKENS.Database) as { exec(sql: string): unknown });

        // Run async initialization
        const userManager = container.resolve(UserManager);
        await userManager.initDefaultUser();
        
        const policyEngine = container.resolve(PolicyEngine);
        policyEngine.load("./config/policies.toml");
    },
    start(_ctx: AppComponentContext) {
        // No persistent runtime services.
    },
    stop(_ctx: AppComponentContext) {
        // No persistent runtime services.
    },
    cleanup(_ctx: AppComponentContext) {
        // No teardown needed.
    }
};

export default config;
