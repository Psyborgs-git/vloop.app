import type { DependencyContainer } from "tsyringe";
import { AgentOrchestratorV2 } from "./v2/orchestrator.js";
import { createAgentHandlerV2 } from "./v2/handler.js";
import { registerTools } from "./tools.js";
import type { AppRouterContract, AppToolRegistryContract, AppTopicHandler } from "@orch/shared";

export function registerRoutes(container: DependencyContainer, router: AppRouterContract) {
    const orchestrator = container.resolve(AgentOrchestratorV2);
    router.register("agent", createAgentHandlerV2(orchestrator, orchestrator.repos.canvas) as AppTopicHandler);
}

export function registerPackageTools(container: DependencyContainer, toolRegistry: AppToolRegistryContract, router: AppRouterContract) {
    registerTools(container, toolRegistry, router);
}
