import type { DependencyContainer } from "tsyringe";
import { createVaultHandler } from "./handler.js";
import { VaultStore } from "./store.js";
import type { AppRouterContract, AppTopicHandler } from "@orch/shared";

export function registerRoutes(container: DependencyContainer, router: AppRouterContract) {
    const vaultStore = container.resolve(VaultStore);
    router.register("vault", createVaultHandler(vaultStore) as AppTopicHandler);
}
