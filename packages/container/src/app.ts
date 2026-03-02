import type { DependencyContainer } from "tsyringe";
import type { AppConfig } from "@orch/shared";
import { TOKENS } from "@orch/shared";

import { DockerClient, ImageManager, ContainerManager, LogStreamer, ContainerMonitor } from "./index.js";

const config: AppConfig = {
    name: "@orch/container",
    register(container: DependencyContainer) {
        container.registerSingleton(DockerClient);
        container.register(ImageManager, {
            useFactory: (c) => new ImageManager(c.resolve(DockerClient))
        });
        container.register(ContainerManager, {
            useFactory: (c) => new ContainerManager(c.resolve(DockerClient))
        });
        container.register(LogStreamer, {
            useFactory: (c) => new LogStreamer(c.resolve(DockerClient))
        });
        container.register(ContainerMonitor, {
            useFactory: (c) => new ContainerMonitor(
                c.resolve(DockerClient),
                c.resolve(ContainerManager),
                { logger: c.resolve(TOKENS.Logger) }
            )
        });
    },
    init(container: DependencyContainer) {
        const monitor = container.resolve(ContainerMonitor);
        const logger = container.resolve<any>(TOKENS.Logger);
        monitor.start().catch((err: unknown) => {
            logger.warn({ err }, "Failed to start container monitor");
        });
    },
    cleanup(container: DependencyContainer) {
        const monitor = container.resolve(ContainerMonitor);
        monitor.stop();
    }
};

export default config;
