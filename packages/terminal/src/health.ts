import type { DependencyContainer } from "tsyringe";
import { TerminalManager } from "./index.js";
import type { AppHealthServerContract } from "@orch/shared";

export function registerHealth(container: DependencyContainer, healthServer: AppHealthServerContract) {
    const manager = container.resolve(TerminalManager);

    healthServer.registerSubsystem("terminal", () => {
        return {
            name: "terminal",
            status: "healthy",
            message: `${manager.list().length} active terminal sessions`,
        };
    });
}
