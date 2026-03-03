import type { DependencyContainer } from "tsyringe";

export type AppTopicHandler = (
    action: string,
    payload: unknown,
    context: AppHandlerContext,
) => Promise<unknown> | unknown;

export interface AppHandlerContext {
    request: AppRouterDispatchRequest;
    identity?: string;
    roles?: string[];
    sessionId?: string;
    logger: unknown;
    state: Map<string, unknown>;
    emit?: (type: "stream" | "event", payload: unknown, seq?: number) => void;
    ws?: unknown;
}

export type AppMiddlewareHandler = (
    context: AppHandlerContext,
    next: () => Promise<AppRouterDispatchResponse>,
) => Promise<AppRouterDispatchResponse> | AppRouterDispatchResponse;

export interface AppRouterDispatchRequest {
    id: string;
    topic: string;
    action: string;
    payload: unknown;
    meta: {
        timestamp: string;
        trace_id?: string;
        session_id?: string;
    };
}

export interface AppRouterDispatchResponse {
    id: string;
    topic: string;
    action: string;
    type: string;
    payload: unknown;
    meta: {
        timestamp: string;
        trace_id?: string;
        seq?: number;
    };
}

/**
 * Minimal router contract required by app route/tool modules.
 * Backed by @orch/daemon Router in production.
 */
export interface AppRouterContract {
    register(topic: string, handler: AppTopicHandler): void;
    use(middleware: AppMiddlewareHandler): void;
    dispatch(
        request: AppRouterDispatchRequest,
        logger: unknown,
        emit?: (type: "stream" | "event", payload: unknown, seq?: number) => void,
        ws?: unknown,
    ): Promise<AppRouterDispatchResponse>;
}

export type AppSubsystemStatus = "healthy" | "degraded" | "unhealthy";

export interface AppSubsystemHealth {
    name: string;
    status: AppSubsystemStatus;
    message?: string;
}

/**
 * Minimal health server contract required by app health modules.
 * Backed by @orch/daemon HealthServer in production.
 */
export interface AppHealthServerContract {
    registerSubsystem(name: string, check: () => AppSubsystemHealth): void;
}

export interface AppToolExecutionContext {
    sessionId?: string;
    logger: unknown;
    request?: {
        meta?: {
            trace_id?: string;
            session_id?: string;
        };
    };
}

/**
 * Generic tool definition contract for module registration.
 */
export interface AppToolDefinition<
    Params = unknown,
    Result = unknown,
    Ctx extends AppToolExecutionContext = AppToolExecutionContext,
> {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute?: {
        bivarianceHack: (params: Params, context?: Ctx) => Promise<Result> | Result;
    }["bivarianceHack"];
}

/**
 * Minimal tool registry contract required by app tool modules.
 * Backed by @orch/ai-agent ToolRegistry in production.
 */
export interface AppToolRegistryContract {
    register<
        Params = unknown,
        Result = unknown,
        Ctx extends AppToolExecutionContext = AppToolExecutionContext,
    >(tool: AppToolDefinition<Params, Result, Ctx>): void;
    get?(name: string): AppToolDefinition | undefined;
    list?(): AppToolDefinition[];
}

export type RegisterAppRoutes = (
    container: DependencyContainer,
    router: AppRouterContract,
) => void;

export type RegisterAppHealth = (
    container: DependencyContainer,
    healthServer: AppHealthServerContract,
) => void;

export type RegisterAppTools = (
    container: DependencyContainer,
    toolRegistry: AppToolRegistryContract,
    router: AppRouterContract,
) => void;

export interface AppRoutesModule {
    registerRoutes: RegisterAppRoutes;
    registerPackageTools?: RegisterAppTools;
}

export interface AppHealthModule {
    registerHealth: RegisterAppHealth;
}

export interface AppToolsModule {
    registerTools: RegisterAppTools;
}

export type AppModuleExports = Record<string, unknown> & {
    default?: AppConfig;
};

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
