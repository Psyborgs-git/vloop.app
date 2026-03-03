import type { DependencyContainer } from "tsyringe";
import { createContainerHandler, ImageManager, ContainerManager, LogStreamer } from "./index.js";
import type { AppRouterContract } from "@orch/shared";

export function registerRoutes(container: DependencyContainer, router: AppRouterContract) {
    const imageManager = container.resolve(ImageManager);
    const containerManager = container.resolve(ContainerManager);
    const logStreamer = container.resolve(LogStreamer);

    router.register(
        "container",
        createContainerHandler(imageManager, containerManager, logStreamer)
    );
}
