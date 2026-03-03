import type { DependencyContainer } from "tsyringe";
import { ContainerMonitor } from "./index.js";
import type { AppHealthServerContract } from "@orch/shared";

export function registerHealth(container: DependencyContainer, healthServer: AppHealthServerContract) {
    const monitor = container.resolve(ContainerMonitor);

    healthServer.registerSubsystem("docker", () => {
        return {
            name: "docker",
            status: monitor.isRunning() ? "healthy" : "degraded",
            message: monitor.isRunning()
                ? "Docker connected and monitoring"
                : "Docker monitor inactive",
        };
    });
}
