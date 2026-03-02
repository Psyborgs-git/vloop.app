import type { DependencyContainer } from "tsyringe";
import { TerminalManager } from "./index.js";

export function registerHealth(container: DependencyContainer, healthServer: any) {
    const manager = container.resolve(TerminalManager);

    healthServer.registerSubsystem("terminal", () => {
        return {
            name: "terminal",
            status: "healthy",
            message: `${manager.list().length} active terminal sessions`,
        };
    });
}
