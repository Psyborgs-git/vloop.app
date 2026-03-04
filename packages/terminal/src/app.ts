import type { DependencyContainer } from "tsyringe";
import type { AppComponent, AppComponentContext } from "@orch/shared";
import { TOKENS, resolveConfig } from "@orch/shared";
import { resolve } from "node:path";

import { TerminalManager, TerminalProfileManager, SessionLogger, TerminalSessionStore } from "./index.js";

const config: AppComponent = {
    name: "@orch/terminal",
    register(container: DependencyContainer) {
        container.register(TerminalManager, {
            useFactory: (c) => new TerminalManager(c.resolve(TOKENS.Logger))
        });
        container.register(TerminalProfileManager, {
            useFactory: (c) => new TerminalProfileManager(
                c.resolve(TOKENS.Database),
                c.resolve(TOKENS.DatabaseOrm),
                c.resolve(TOKENS.Logger)
            )
        });
        container.register(TerminalSessionStore, {
            useFactory: (c) => new TerminalSessionStore(
                c.resolve(TOKENS.Database),
                c.resolve(TOKENS.DatabaseOrm),
                c.resolve(TOKENS.Logger)
            )
        });
        container.register(SessionLogger, {
            useFactory: (c) => new SessionLogger({
                logDir: resolve(resolveConfig(c, 'terminal').log_path),
                logger: c.resolve(TOKENS.Logger),
                sessionStore: c.resolve(TerminalSessionStore)
            })
        });
    },
    init(_ctx: AppComponentContext) {
        // No one-time setup; sessions are created on demand.
    },
    start(_ctx: AppComponentContext) {
        // Terminal sessions are created on demand, no persistent runtime.
    },
    stop({ container }: AppComponentContext) {
        const terminalManager = container.resolve(TerminalManager);
        const sessionLogger = container.resolve(SessionLogger);
        terminalManager.shutdownAll();
        sessionLogger.shutdownAll();
    },
    cleanup({ container }: AppComponentContext) {
        const terminalManager = container.resolve(TerminalManager);
        const sessionLogger = container.resolve(SessionLogger);
        terminalManager.shutdownAll();
        sessionLogger.shutdownAll();
    }
};

export default config;
