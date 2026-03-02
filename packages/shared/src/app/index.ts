import type { DependencyContainer } from "tsyringe";

/**
 * Base App configuration interface.
 * Any plugin/app module should export a default object conforming to this interface
 * in its `index.ts` or `app.ts` file.
 */
export interface AppConfig {
    name: string;
    dependencies?: string[];
    
    /**
     * Synchronous registration of injectables.
     * Use this phase to map abstract interfaces to concrete classes in the container.
     */
    register?(container: DependencyContainer): void;
    
    /**
     * Initiation phase. 
     * Use this to run migrations, initialize background jobs, or connect to external systems.
     * Can be async.
     */
    init?(container: DependencyContainer): Promise<void> | void;
    
    /**
     * Cleanup hook.
     * Called during orchestrator shutdown. Use this to close connections or cancel loops.
     */
    cleanup?(container: DependencyContainer): Promise<void> | void;
}

/**
 * Common configuration structure for Orchestrator Applications via `config.toml`
 */
export interface OrchestratorAppsConfig {
    installed: string[];
}
