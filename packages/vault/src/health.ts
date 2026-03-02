import type { DependencyContainer } from "tsyringe";
import { VaultCrypto } from "./crypto.js";

export function registerHealth(container: DependencyContainer, healthServer: any) {
    const vaultCrypto = container.resolve(VaultCrypto);
    healthServer.registerSubsystem("vault", () => ({
        name: "vault",
        status: vaultCrypto.isUnlocked() ? "healthy" : "unhealthy",
    }));
}