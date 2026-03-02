import type { DependencyContainer } from "tsyringe";
import { createContainerHandler, ImageManager, ContainerManager, LogStreamer } from "./index.js";

export function registerRoutes(container: DependencyContainer, router: any) {
    const imageManager = container.resolve(ImageManager);
    const containerManager = container.resolve(ContainerManager);
    const logStreamer = container.resolve(LogStreamer);

    router.register(
        "container",
        createContainerHandler(imageManager, containerManager, logStreamer)
    );
}
