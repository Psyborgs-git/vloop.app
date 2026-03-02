import type { DependencyContainer } from "tsyringe";
import { createAgentHandler, AgentOrchestrator, AIConfigStore } from "./index.js";

export function registerRoutes(container: DependencyContainer, router: any) {
    const orchestrator = container.resolve(AgentOrchestrator);
    const store = container.resolve(AIConfigStore);
    router.register("agent", createAgentHandler(orchestrator, store));
}
