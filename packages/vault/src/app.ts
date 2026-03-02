import type { DependencyContainer } from "tsyringe";
import type { AppConfig } from "@orch/shared";
import { TOKENS } from "@orch/shared";

import { VaultCrypto } from "./crypto.js";
import { VaultStore } from "./store.js";

const config: AppConfig = {
    name: "@orch/vault",
    register(container: DependencyContainer) {
        container.registerSingleton(VaultCrypto);
        const config = container.resolve<any>(TOKENS.Config);
        const vaultStore = new VaultStore(
            container.resolve(TOKENS.Database),
            container.resolve(VaultCrypto),
            config.vault.max_secret_versions
        );
        container.register(VaultStore, { useValue: vaultStore });
        container.register(TOKENS.VaultStore, { useValue: vaultStore });
    },
    async init(container: DependencyContainer) {
        const vaultStore = container.resolve(VaultStore);
        const passphrase = container.resolve<string>(TOKENS.VaultPassphrase);
        // Ensure vaultCrypto is instantiated
        container.resolve(VaultCrypto);
        await vaultStore.init(passphrase);
    },
    cleanup(container: DependencyContainer) {
        const vaultCrypto = container.resolve(VaultCrypto);
        vaultCrypto.zeroize();
    }
};

export default config;
