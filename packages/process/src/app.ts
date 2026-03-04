import type { DependencyContainer } from "tsyringe";
import type { AppComponent, AppComponentContext } from "@orch/shared";
import { TOKENS } from "@orch/shared";

import { ProcessManager, CronScheduler, ProcessLogManager } from "./index.js";

const config: AppComponent = {
    name: "@orch/process",
    register(container: DependencyContainer) {
        container.register(ProcessManager, {
            useFactory: (c) => new ProcessManager(c.resolve(TOKENS.Logger))
        });
        container.register(CronScheduler, {
            useFactory: (c) => new CronScheduler(c.resolve(TOKENS.Logger))
        });
        container.registerSingleton(ProcessLogManager);
    },
    init({ container }: AppComponentContext) {
        const processManager = container.resolve(ProcessManager);
        const cronScheduler = container.resolve(CronScheduler);

        cronScheduler.setExecutor(async (job) => {
            const managed = processManager.start({
                id: `cron-${job.id}-${Date.now()}`,
                command: job.command,
                args: job.args,
                cwd: job.cwd,
                env: job.env,
                restartPolicy: "never",
                maxRestarts: 0,
            });

            return new Promise((resolve) => {
                const check = setInterval(() => {
                    const processInfo = processManager.get(managed.id);
                    if (
                        processInfo.status === "stopped" ||
                        processInfo.status === "failed"
                    ) {
                        clearInterval(check);
                        resolve({ exitCode: processInfo.lastExitCode ?? 1 });
                    }
                }, 1000);
            });
        });
    },
    start({ container }: AppComponentContext) {
        const cronScheduler = container.resolve(CronScheduler);
        cronScheduler.start();
    },
    stop({ container }: AppComponentContext) {
        const cronScheduler = container.resolve(CronScheduler);
        cronScheduler.stop();
    },
    async cleanup({ container }: AppComponentContext) {
        const processManager = container.resolve(ProcessManager);
        const cronScheduler = container.resolve(CronScheduler);
        cronScheduler.stop();
        await processManager.shutdownAll();
    }
};

export default config;