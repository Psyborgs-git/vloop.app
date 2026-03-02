import type { DependencyContainer } from "tsyringe";
import { PluginManager, createPluginHandler } from "./index.js";

export function registerRoutes(container: DependencyContainer, router: any): void {
    const pluginManager = container.resolve(PluginManager);
    router.register("plugin", createPluginHandler(pluginManager));
}