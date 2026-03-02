import type { DependencyContainer } from "tsyringe";
import type { AppConfig } from "@orch/shared";
import { TOKENS } from "@orch/shared";
import { resolve } from "node:path";
import { VaultStore } from "@orch/vault";

import { DatabaseProvisioner, DatabasePool, ExternalDatabaseRegistry } from "./index.js";

const config: AppConfig = {
    name: "@orch/db-manager",
    dependencies: ["@orch/vault"],
    register(container: DependencyContainer) {
        container.register(DatabaseProvisioner, {
            useFactory: (c) => new DatabaseProvisioner(
                resolve("./data/workspaces"),
                c.resolve(VaultStore),
                c.resolve(TOKENS.Logger)
            )
        });
        container.register(DatabasePool, {
            useFactory: (c) => new DatabasePool(
                c.resolve(DatabaseProvisioner),
                c.resolve(TOKENS.Logger)
            )
        });
        container.register(ExternalDatabaseRegistry, {
            useFactory: (c) => new ExternalDatabaseRegistry(
                c.resolve(TOKENS.Database),
                c.resolve(VaultStore),
                c.resolve(TOKENS.Logger)
            )
        });
    },
    cleanup(container: DependencyContainer) {
        const dbPool = container.resolve(DatabasePool);
        dbPool.shutdownAll();
    }
};

export default config;
