import type { DependencyContainer } from "tsyringe";
import type { AppConfig } from "@orch/shared";
import { TOKENS } from "@orch/shared";
import { resolve } from "node:path";

import { TerminalManager, TerminalProfileManager, SessionLogger, TerminalSessionStore } from "./index.js";

const config: AppConfig = {
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
                logDir: resolve("./data/terminal-logs"), // Or from config
                logger: c.resolve(TOKENS.Logger),
                sessionStore: c.resolve(TerminalSessionStore)
            })
        });
    },
    cleanup(container: DependencyContainer) {
        const terminalManager = container.resolve(TerminalManager);
        const sessionLogger = container.resolve(SessionLogger);
        terminalManager.shutdownAll();
        sessionLogger.shutdownAll();
    }
};

export default config;
