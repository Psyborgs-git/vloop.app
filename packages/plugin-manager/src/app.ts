import type { DependencyContainer } from "tsyringe";
import type { AppComponent, AppComponentContext } from "@orch/shared";
import { TOKENS } from "@orch/shared";
import type { VaultStore } from "@orch/vault";
import { HooksEventBus } from "@orch/shared/hooks-bus";
import type { Logger } from "@orch/daemon";

import { PluginManager } from "./index.js";

const config: AppComponent = {
    name: "@orch/plugin-manager",
    dependencies: [],
    register(container: DependencyContainer) {
        container.register(PluginManager, {
            useFactory: (c) => {
                // Optionally resolve VaultStore and HooksEventBus — they may not always be registered
                let vaultStore: VaultStore | undefined;
                try {
                    vaultStore = c.resolve<VaultStore>(TOKENS.VaultStore);
                } catch {
                    // VaultStore not registered in this context; vault host functions will be disabled
                }

                let eventBus: HooksEventBus | undefined;
                try {
                    eventBus = c.resolve(HooksEventBus);
                } catch {
                    // HooksEventBus not registered in this context; events host functions will be disabled
                }

                return new PluginManager(
                    c.resolve(TOKENS.Database),
                    c.resolve(TOKENS.DatabaseOrm),
                    c.resolve(TOKENS.Logger),
                    undefined, // dataDir — use the PluginManager default: './data/plugins'
                    vaultStore,
                    eventBus
                );
            }
        });
    },
    init(_ctx: AppComponentContext) {
        // No one-time migrations; runtime start is in start().
    },
    async start({ container }: AppComponentContext) {
        const manager = container.resolve(PluginManager);
        const logger = container.resolve<Logger>(TOKENS.Logger);

        // Auto-install any bundled extensions that are not yet in the DB
        try {
            await manager.autoInstallFromDir('./extensions');
        } catch (err) {
            logger.warn({ err }, 'Failed to auto-install bundled extensions');
        }

        try {
            await manager.start();
        } catch (err) {
            logger.error({ err }, "Failed to start plugins");
        }
    },
    async stop({ container }: AppComponentContext) {
        const manager = container.resolve(PluginManager);
        await manager.stop();
    },
    async cleanup({ container }: AppComponentContext) {
        const manager = container.resolve(PluginManager);
        await manager.stop();
    }
};

export default config;
