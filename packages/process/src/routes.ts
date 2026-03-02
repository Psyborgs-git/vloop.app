import type { DependencyContainer } from "tsyringe";
import { createProcessHandler, ProcessManager, CronScheduler, ProcessLogManager } from "./index.js";

export function registerRoutes(container: DependencyContainer, router: any) {
    const processManager = container.resolve(ProcessManager);
    const cronScheduler = container.resolve(CronScheduler);
    const processLogManager = container.resolve(ProcessLogManager);
    
    router.register(
        "process",
        createProcessHandler(processManager, cronScheduler, processLogManager)
    );
    router.register(
        "schedule",
        createProcessHandler(processManager, cronScheduler, processLogManager)
    );
}
