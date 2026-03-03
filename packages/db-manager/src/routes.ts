import type { DependencyContainer } from "tsyringe";
import { TOKENS } from "@orch/shared";
import { createDatabaseHandler, DatabaseProvisioner, DatabasePool, ExternalDatabaseRegistry } from "./index.js";
import type { AppRouterContract, AppTopicHandler } from "@orch/shared";
import { DatabaseManager } from "@orch/shared/db";

// We'll need the Root DatabaseManager for the handler wrapper.
// Assuming we register the Root db manager in orchestrator as TOKENS.DatabaseManager
export function registerRoutes(container: DependencyContainer, router: AppRouterContract) {
    const dbProvisioner = container.resolve(DatabaseProvisioner);
    const dbPool = container.resolve(DatabasePool);
    const rootDbManager = container.resolve<DatabaseManager>(TOKENS.DatabaseManager);
    const externalRegistry = container.resolve(ExternalDatabaseRegistry);

    router.register(
        "db",
        createDatabaseHandler(dbProvisioner, dbPool, rootDbManager, externalRegistry) as AppTopicHandler,
    );
}
