import type { DependencyContainer } from "tsyringe";
import type { AppComponent, AppComponentContext } from "@orch/shared";
import { TOKENS, resolveConfig } from "@orch/shared";

import { VaultCrypto } from "./crypto.js";
import { VaultStore } from "./store.js";

const config: AppComponent = {
    name: "@orch/vault",
    register(container: DependencyContainer) {
        container.registerSingleton(VaultCrypto);
        const { max_secret_versions } = resolveConfig(container, 'vault');
        const vaultStore = new VaultStore(
            container.resolve(TOKENS.Database),
            container.resolve(TOKENS.DatabaseOrm),
            container.resolve(VaultCrypto),
            max_secret_versions
        );
        container.register(VaultStore, { useValue: vaultStore });
        container.register(TOKENS.VaultStore, { useValue: vaultStore });
    },
    async init({ container }: AppComponentContext) {
        const vaultStore = container.resolve(VaultStore);
        const passphrase = container.resolve<string>(TOKENS.VaultPassphrase);
        // Ensure vaultCrypto is instantiated
        container.resolve(VaultCrypto);
        await vaultStore.init(passphrase);
    },
    start(_ctx: AppComponentContext) {
        // No persistent runtime services.
    },
    stop(_ctx: AppComponentContext) {
        // No persistent runtime services.
    },
    cleanup({ container }: AppComponentContext) {
        const vaultCrypto = container.resolve(VaultCrypto);
        vaultCrypto.zeroize();
    }
};

export default config;
