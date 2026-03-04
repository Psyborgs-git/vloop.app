import type { DependencyContainer } from "tsyringe";
import type { AppComponent, AppComponentContext } from "@orch/shared";
import { TOKENS } from "@orch/shared";

import { DockerClient, ImageManager, ContainerManager, LogStreamer, ContainerMonitor } from "./index.js";

const config: AppComponent = {
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
    init(_ctx: AppComponentContext) {
        // No one-time setup needed; runtime monitor starts in start().
    },
    start({ container }: AppComponentContext) {
        const monitor = container.resolve(ContainerMonitor);
        const logger = container.resolve<any>(TOKENS.Logger);
        monitor.start().catch((err: unknown) => {
            logger.warn({ err }, "Failed to start container monitor");
        });
    },
    stop({ container }: AppComponentContext) {
        const monitor = container.resolve(ContainerMonitor);
        monitor.stop();
    },
    cleanup({ container }: AppComponentContext) {
        const monitor = container.resolve(ContainerMonitor);
        monitor.stop();
    }
};

export default config;
