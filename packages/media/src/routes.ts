import { resolve } from "node:path";
import type { DependencyContainer } from "tsyringe";
import { createMediaHandler } from "./handler.js";
import type { AppRouterContract } from "@orch/shared";

export function registerRoutes(
    _container: DependencyContainer,
    router: AppRouterContract,
): void {
    router.register("media", createMediaHandler(resolve("./data/media")));
}
