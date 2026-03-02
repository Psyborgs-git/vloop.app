import type { DependencyContainer } from "tsyringe";
import { ProcessManager, CronScheduler } from "./index.js";

export function registerHealth(container: DependencyContainer, healthServer: any) {
    const processManager = container.resolve(ProcessManager);
    const cronScheduler = container.resolve(CronScheduler);

    healthServer.registerSubsystem("process", () => {
        return {
            name: "process",
            status: "healthy",
            message: `${processManager.list().length} processes, ${cronScheduler.list().length} schedules`,
        };
    });
}
