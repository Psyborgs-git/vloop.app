import type { DependencyContainer } from "tsyringe";
import { PluginManager, createPluginHandler } from "./index.js";
import type { AppRouterContract } from "@orch/shared";

export function registerRoutes(container: DependencyContainer, router: AppRouterContract): void {
    const pluginManager = container.resolve(PluginManager);
    router.register("plugin", createPluginHandler(pluginManager));
}