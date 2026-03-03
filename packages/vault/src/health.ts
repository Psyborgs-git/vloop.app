import type { DependencyContainer } from "tsyringe";
import { VaultCrypto } from "./crypto.js";
import type { AppHealthServerContract } from "@orch/shared";

export function registerHealth(container: DependencyContainer, healthServer: AppHealthServerContract) {
    const vaultCrypto = container.resolve(VaultCrypto);
    healthServer.registerSubsystem("vault", () => ({
        name: "vault",
        status: vaultCrypto.isUnlocked() ? "healthy" : "unhealthy",
    }));
}