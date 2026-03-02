import type { DependencyContainer } from "tsyringe";
import { TOKENS } from "@orch/shared";
import { createDatabaseHandler, DatabaseProvisioner, DatabasePool, ExternalDatabaseRegistry } from "./index.js";

// We'll need the Root DatabaseManager for the handler wrapper.
// Assuming we register the Root db manager in orchestrator as TOKENS.DatabaseManager
export function registerRoutes(container: DependencyContainer, router: any) {
    const dbProvisioner = container.resolve(DatabaseProvisioner);
    const dbPool = container.resolve(DatabasePool);
    const rootDbManager = container.resolve<any>(TOKENS.DatabaseManager);
    const externalRegistry = container.resolve(ExternalDatabaseRegistry);

    router.register(
        "db",
        createDatabaseHandler(dbProvisioner, dbPool, rootDbManager, externalRegistry)
    );
}
