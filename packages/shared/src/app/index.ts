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
    default?: AppComponent;
};

// ── Component lifecycle ──────────────────────────────────────────────────────

export const ComponentState = {
    Created: "created",
    Registered: "registered",
    Initialized: "initialized",
    Running: "running",
    Stopped: "stopped",
    Error: "error",
    Destroyed: "destroyed",
} as const;

export type ComponentStateValue =
    (typeof ComponentState)[keyof typeof ComponentState];

export interface ComponentStatus {
    name: string;
    state: ComponentStateValue;
    startedAt?: string;
    stoppedAt?: string;
    error?: string;
}

/**
 * Injected context available to components during lifecycle phases.
 * Provided by the orchestrator gateway.
 */
export interface AppComponentContext {
    container: DependencyContainer;
    healthRegistry: AppHealthServerContract;
    shutdownSignal: AbortSignal;
    router: AppRouterContract;
    toolRegistry?: AppToolRegistryContract;
}

/**
 * Strict component contract for all orchestrator applications.
 *
 * Every installed package must export a default `AppComponent` from its
 * `app.ts` entry-point.  The orchestrator calls lifecycle methods in a
 * well-defined order:
 *
 *   register → init → start → … → stop → cleanup
 *
 * This mirrors a React-like mount/unmount lifecycle: components manage
 * their own runtime state while the orchestrator controls context injection,
 * dependency ordering, and permission enforcement.
 */
export interface AppComponent {
    readonly name: string;
    readonly dependencies?: readonly string[];

    /**
     * Synchronous DI registration phase.
     * Map abstract interfaces to concrete implementations in the container.
     * Called once at startup, in dependency order.
     */
    register(container: DependencyContainer): void;

    /**
     * One-time async initialization: run migrations, create schemas, seed
     * data, or establish connections.  Called once at startup after all
     * components have been registered, in dependency order.
     */
    init(ctx: AppComponentContext): Promise<void> | void;

    /**
     * Start runtime services: background jobs, HTTP servers, listeners,
     * monitors.  May be called more than once across the component lifetime
     * (after a stop → start restart cycle).  Called in dependency order.
     */
    start(ctx: AppComponentContext): Promise<void> | void;

    /**
     * Gracefully stop runtime services.  Must be idempotent — safe to
     * call multiple times.  Called in reverse dependency order.
     */
    stop(ctx: AppComponentContext): Promise<void> | void;

    /**
     * Final teardown: close connections, zero sensitive memory, release
     * resources.  Called once at daemon shutdown after stop(), in reverse
     * dependency order.  No recovery is possible after cleanup.
     */
    cleanup(ctx: AppComponentContext): Promise<void> | void;

    /**
     * Optional inline health check.  When provided, the lifecycle manager
     * automatically registers it with the health server on component start.
     */
    healthCheck?(ctx: AppComponentContext): AppSubsystemHealth;
}

/**
 * Common configuration structure for Orchestrator Applications via `config.toml`
 */
export interface OrchestratorAppsConfig {
    installed: string[];
}
