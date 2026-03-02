import type { DependencyContainer } from "tsyringe";
import { createVaultHandler } from "./handler.js";
import { VaultStore } from "./store.js";

export function registerRoutes(container: DependencyContainer, router: any) {
    const vaultStore = container.resolve(VaultStore);
    router.register("vault", createVaultHandler(vaultStore));
}
