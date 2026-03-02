import type { DependencyContainer } from "tsyringe";
import { createTerminalHandler, TerminalManager, TerminalProfileManager, SessionLogger, TerminalSessionStore } from "./index.js";

export function registerRoutes(container: DependencyContainer, router: any) {
    const manager = container.resolve(TerminalManager);
    const profileManager = container.resolve(TerminalProfileManager);
    const sessionLogger = container.resolve(SessionLogger);
    const sessionStore = container.resolve(TerminalSessionStore);

    router.register(
        "terminal",
        createTerminalHandler(manager, profileManager, sessionLogger, sessionStore)
    );
}
