import type { DependencyContainer } from "tsyringe";
import type { AppComponent, AppComponentContext } from "@orch/shared";
import { TOKENS } from "@orch/shared";
import { DatabaseProvisioner } from "@orch/db-manager";

import { PluginManager } from "./index.js";

const config: AppComponent = {
    name: "@orch/plugin-manager",
    dependencies: ["@orch/db-manager"],
    register(container: DependencyContainer) {
        container.register(PluginManager, {
            useFactory: (c) => new PluginManager(
                c.resolve(TOKENS.Database),
                c.resolve(TOKENS.DatabaseOrm),
                c.resolve(DatabaseProvisioner),
                c.resolve(TOKENS.Logger)
            )
        });
    },
    init(_ctx: AppComponentContext) {
        // No one-time migrations; runtime start is in start().
    },
    async start({ container }: AppComponentContext) {
        const manager = container.resolve(PluginManager);
        const logger = container.resolve<any>(TOKENS.Logger);
        
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
