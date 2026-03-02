import { resolve, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { container as rootContainer } from "tsyringe";
import type { DependencyContainer } from "tsyringe";
import {
    createLogger,
    Router,
    createWebSocketServer,
    createHealthServer,
    setupSignalHandlers,
    killExistingDaemon,
    writePidFile,
    removePidFile,
    killProcessesOnPorts,
} from "@orch/daemon";
import type { Logger } from "@orch/daemon";
import { DatabaseManager } from "@orch/shared/db";
import { TOKENS } from "@orch/shared";
import type { AppConfig } from "@orch/shared";
import { createMcpHttpHandler } from "./mcp-server.js";
import { createCanvasServer } from "./canvas-server.js";
import { registerAITools } from "./ai-tools.js";
import { registerCanvasTools } from "./canvas-tools.js";

export class OrchestratorApp {
    private config: any;
    private logger: Logger;
    private container: DependencyContainer;

    private loadedApps: AppConfig[] = [];
    private dbManager!: DatabaseManager;
    private wsHandle!: any;
    private healthServer!: any;
    private canvasServer!: any;
    private shutdownController!: AbortController;
    private onReload!: (callback: () => void) => void;

    constructor(config: any) {
        this.config = config;
        this.logger = createLogger(config.daemon.log_level);
        this.container = rootContainer.createChildContainer();
    }

    public async start(): Promise<void> {
        try {
            await this.initPid();
            this.setupSignalHandlers();

            this.registerCore();
            await this.loadAndRegisterApps();
            await this.initializeApps();

            const router = new Router(this.logger);
            const toolRegistry = await this.resolveToolRegistry();
            await this.buildAutoRoutes(router, toolRegistry);
            await this.startServers(router, toolRegistry);

            this.setupReloadHandler();

            await this.waitForShutdown();
            await this.cleanup();
        } catch (err) {
            this.logger.error({ err }, "Fatal error during startup");
            await this.cleanup(); // Try to cleanup even on error
            process.exit(1);
        }
    }

    private async initPid() {
        await killExistingDaemon(this.config.daemon.pid_file, this.logger);
        const pidWritten = await writePidFile(this.config.daemon.pid_file);
        if (!pidWritten) {
            this.logger.warn({ pidFile: this.config.daemon.pid_file }, "Could not write pid file");
        }

        await killProcessesOnPorts(
            [
                this.config.network.health_port,
                this.config.network.ws_port,
                this.config.network.canvas_port,
            ],
            this.logger,
        );

        process.on("exit", () => {
            try {
                removePidFile(this.config.daemon.pid_file);
            } catch { }
        });

        this.logger.info(
            { config: { ...this.config, tls: "***", auth: "***" } },
            "Configuration loaded",
        );
    }

    private setupSignalHandlers() {
        const { shutdownController, onReload } = setupSignalHandlers(this.logger);
        this.shutdownController = shutdownController;
        this.onReload = onReload;
    }

    private registerCore(): void {
        this.container.register(TOKENS.Config, { useValue: this.config });
        this.container.register(TOKENS.Logger, { useValue: this.logger });

        const dbKeyPath = resolve("./data/keys/db.key");
        const dbPassphrase = this.getOrGeneratePassphrase(dbKeyPath, "ORCH_DB_PASSPHRASE");

        this.dbManager = new DatabaseManager({
            path: resolve(this.config.database.path),
            passphrase: dbPassphrase,
        });

        const db = this.dbManager.open();
        this.logger.info({ path: this.config.database.path }, "Encrypted database opened");

        this.container.register(TOKENS.DatabaseManager, { useValue: this.dbManager });
        this.container.register(TOKENS.Database, { useValue: db });

        const vaultKeyPath = resolve("./data/keys/vault.key");
        const vaultPassphrase = this.getOrGeneratePassphrase(vaultKeyPath, "ORCH_VAULT_PASSPHRASE");
        this.container.register(TOKENS.VaultPassphrase, { useValue: vaultPassphrase });
    }

    private async loadAndRegisterApps(): Promise<void> {
        const installedApps: string[] = this.config.applications?.installed ?? [];
        const discovered: AppConfig[] = [];

        for (const pkgName of installedApps) {
            this.logger.debug({ pkgName }, "Loading app module");
            const appModule = await import(`${pkgName}/app`);
            const appConfig = this.extractAppConfig(pkgName, appModule);
            discovered.push(appConfig);
        }

        this.loadedApps = this.orderAppsByDependencies(discovered);

        for (const app of this.loadedApps) {
            if (app.register) {
                this.logger.debug({ app: app.name }, "Registering app");
                app.register(this.container);
            }
            this.logger.info({ app: app.name }, "App registered");
        }
    }

    private async initializeApps(): Promise<void> {
        for (const app of this.loadedApps) {
            if (app.init) {
                this.logger.debug({ app: app.name }, "Initializing app");
                await app.init(this.container);
            }
        }
    }

    private async resolveToolRegistry(): Promise<any | null> {
        try {
            const aiModule = await import("@orch/ai-agent");
            if (!aiModule.ToolRegistry) {
                return null;
            }
            return this.container.resolve(aiModule.ToolRegistry);
        } catch {
            return null;
        }
    }

    private async buildAutoRoutes(router: Router, toolRegistry: any | null): Promise<void> {
        this.healthServer = createHealthServer(
            this.config.network.health_port,
            this.config.network.bind_address,
            this.logger,
        );

        this.healthServer.registerSubsystem("database", () => ({
            name: "database",
            status: this.dbManager.isOpen() ? "healthy" : "unhealthy",
        }));

        for (const app of this.loadedApps) {
            const pkgName = app.name;

            const routesModule = await this.importOptional(`${pkgName}/routes`, `${pkgName}/routes`);
            if (routesModule?.registerRoutes) {
                routesModule.registerRoutes(this.container, router);
                this.logger.debug({ app: pkgName }, "Routes discovered");
            }

            const healthModule = await this.importOptional(`${pkgName}/health`, `${pkgName}/health`);
            if (healthModule?.registerHealth) {
                healthModule.registerHealth(this.container, this.healthServer);
                this.logger.debug({ app: pkgName }, "Health checks discovered");
            }

            if (toolRegistry) {
                const toolsModule = await this.importOptional(`${pkgName}/tools`, `${pkgName}/tools`);
                if (toolsModule?.registerTools) {
                    toolsModule.registerTools(this.container, toolRegistry, router);
                    this.logger.debug({ app: pkgName }, "Tools discovered");
                }
            }
        }

        router.register("session", async (action, _payload, context) => {
            const authModule = await import("@orch/auth");
            const sessionManager = this.container.resolve<any>(authModule.SessionManager);

            switch (action) {
                case "info":
                    return {
                        session_id: context.sessionId,
                        identity: context.identity,
                        roles: context.roles,
                    };
                case "refresh":
                    if (!context.sessionId) throw new Error("No session");
                    return sessionManager.refresh(context.sessionId);
                case "list":
                    return { sessions: sessionManager.listActive() };
                default:
                    throw new Error(`Unknown session action: ${action}`);
            }
        });

        router.register("health", async (action) => {
            switch (action) {
                case "check":
                    return { status: "healthy", timestamp: new Date().toISOString() };
                default:
                    throw new Error(`Unknown health action: ${action}`);
            }
        });

        if (toolRegistry) {
            registerAITools(toolRegistry, router);
            registerCanvasTools(toolRegistry, router);

            router.register("canvas", async (action, payload) => {
                const stateManager = this.canvasServer?.stateManager;
                if (!stateManager) throw new Error("Canvas runtime is not ready yet");

                const canvasId = (payload as any)?.canvasId;
                if (!canvasId || typeof canvasId !== "string") {
                    throw new Error("canvasId is required");
                }

                switch (action) {
                    case "update_state": {
                        const partialState = (payload as any)?.state ?? {};
                        stateManager.updateState(canvasId, partialState);
                        return { canvasId, state: stateManager.getState(canvasId) };
                    }
                    case "broadcast_event": {
                        const type = (payload as any)?.type;
                        if (!type || typeof type !== "string") {
                            throw new Error("type is required");
                        }
                        stateManager.broadcast(canvasId, {
                            type,
                            payload: (payload as any)?.payload,
                            canvasId,
                        });
                        return { ok: true };
                    }
                    case "toast": {
                        const message = (payload as any)?.message;
                        if (!message || typeof message !== "string") {
                            throw new Error("message is required");
                        }
                        stateManager.pushToast(canvasId, {
                            message,
                            severity: (payload as any)?.severity,
                            durationMs: (payload as any)?.durationMs,
                        });
                        return { ok: true };
                    }
                    case "request_input": {
                        const message = (payload as any)?.message;
                        if (!message || typeof message !== "string") {
                            throw new Error("message is required");
                        }
                        return stateManager.requestInput(canvasId, {
                            title: (payload as any)?.title,
                            message,
                            placeholder: (payload as any)?.placeholder,
                            defaultValue: (payload as any)?.defaultValue,
                            confirmLabel: (payload as any)?.confirmLabel,
                            cancelLabel: (payload as any)?.cancelLabel,
                            inputType: (payload as any)?.inputType,
                            timeoutMs: (payload as any)?.timeoutMs,
                        });
                    }
                    case "get_state":
                        return { canvasId, state: stateManager.getState(canvasId) };
                    default:
                        throw new Error(`Unknown canvas action: ${action}`);
                }
            });
        }
    }

    private async startServers(router: Router, toolRegistry: any | null): Promise<void> {
        await this.healthServer.listen();

        let mcpHttpHandler: any = undefined;
        if (toolRegistry) {
            try {
                const authModule = await import("@orch/auth");
                const sessionManager = this.container.resolve(authModule.SessionManager);
                mcpHttpHandler = createMcpHttpHandler(toolRegistry, sessionManager, this.logger);
            } catch (err) {
                this.logger.warn({ err }, "MCP HTTP handler disabled: auth subsystem unavailable");
            }
        }

        this.wsHandle = createWebSocketServer(
            this.config,
            router,
            this.logger,
            this.shutdownController.signal,
            mcpHttpHandler,
        );

        this.healthServer.registerSubsystem("websocket", () => ({
            name: "websocket",
            status: "healthy",
            message: `${this.wsHandle.connectionCount()} active connections`,
        }));
        try {
            const aiModule = await import("@orch/ai-agent");
            if (aiModule.AIConfigStore) {
                const aiConfigStore = this.container.resolve(aiModule.AIConfigStore);
                this.canvasServer = createCanvasServer(
                    this.config.network.canvas_port,
                    this.config.network.bind_address,
                    this.logger,
                    aiConfigStore,
                    this.config.storage.canvas_path,
                );
                await this.canvasServer.listen();
                this.healthServer.registerSubsystem("canvas", () => ({
                    name: "canvas",
                    status: "healthy",
                    message: `Canvas server running on port ${this.config.network.canvas_port}`,
                }));
            }
        } catch {
            // Canvas/AI subsystem optional.
        }

        this.healthServer.markReady();
        this.logger.info("🚀 Orchestrator daemon is ready");
    }

    private setupReloadHandler() {
        this.onReload(() => {
            void (async () => {
                try {
                    const authModule = await import("@orch/auth");
                    if (!authModule.PolicyEngine) return;
                    const policyEngine = this.container.resolve(authModule.PolicyEngine);
                    if (typeof policyEngine.reload === "function") {
                        policyEngine.reload(resolve("./config/policies.toml"));
                        this.logger.info("RBAC policies reloaded");
                    }
                } catch (err) {
                    this.logger.error({ err }, "Failed to reload policies");
                }
            })();
        });
    }

    private async waitForShutdown() {
        await new Promise<void>((resolve) => {
            this.shutdownController.signal.addEventListener("abort", () => resolve());
        });
        this.logger.info("Shutting down...");
    }

    private async cleanup() {
        if (this.shutdownController && !this.shutdownController.signal.aborted) {
            this.shutdownController.abort();
        }

        for (let i = this.loadedApps.length - 1; i >= 0; i--) {
            const app = this.loadedApps[i];
            if (!app?.cleanup) continue;
            try {
                this.logger.debug({ app: app.name }, "Cleaning up app");
                await app.cleanup(this.container);
            } catch (err) {
                this.logger.error({ err, app: app.name }, "Error during app cleanup");
            }
        }

        if (this.canvasServer) await this.canvasServer.close();
        if (this.wsHandle) await this.wsHandle.close();
        if (this.healthServer) await this.healthServer.close();
        if (this.dbManager) this.dbManager.close();

        try { await removePidFile(this.config.daemon.pid_file); } catch { }

        this.logger.info("Orchestrator daemon stopped. Goodbye.");
    }

    private extractAppConfig(pkgName: string, appModule: Record<string, unknown>): AppConfig {
        const defaultExport = appModule.default as AppConfig | undefined;
        if (defaultExport?.name) {
            return defaultExport;
        }

        const directExport = appModule as unknown as AppConfig;
        if (directExport?.name) {
            return directExport;
        }

        for (const key of Object.keys(appModule)) {
            const candidate = appModule[key] as AppConfig | undefined;
            if (candidate?.name) {
                return candidate;
            }
        }

        throw new Error(`Invalid app config in ${pkgName}/app`);
    }

    private orderAppsByDependencies(apps: AppConfig[]): AppConfig[] {
        const byName = new Map(apps.map((app) => [app.name, app]));
        const visited = new Set<string>();
        const inStack = new Set<string>();
        const ordered: AppConfig[] = [];

        const visit = (name: string) => {
            if (visited.has(name)) return;
            if (inStack.has(name)) {
                throw new Error(`Circular app dependency detected at ${name}`);
            }
            const app = byName.get(name);
            if (!app) return;

            inStack.add(name);
            for (const dep of app.dependencies ?? []) {
                visit(dep);
            }
            inStack.delete(name);
            visited.add(name);
            ordered.push(app);
        };

        for (const app of apps) {
            visit(app.name);
        }
        return ordered;
    }

    private async importOptional(specifier: string, expectedInError: string): Promise<any | undefined> {
        try {
            return await import(specifier);
        } catch (err: any) {
            if (this.isMissingOptionalModule(err, specifier, expectedInError)) {
                return undefined;
            }
            throw err;
        }
    }

    private isMissingOptionalModule(err: any, specifier: string, expectedInError: string): boolean {
        if (!err || err.code !== "ERR_MODULE_NOT_FOUND") {
            return false;
        }
        const msg = String(err.message ?? "");
        const lastSegment = specifier.split("/").pop();
        if (!lastSegment) return false;

        return (
            msg.includes(expectedInError)
            || msg.includes(specifier)
            || msg.includes(`/dist/${lastSegment}.js`)
        );
    }

    private getOrGeneratePassphrase(keyPath: string, envVarName: string): string {
        if (process.env[envVarName]) {
            this.logger.info(`Using passphrase from environment variable ${envVarName}`);
            return process.env[envVarName]!;
        }

        if (existsSync(keyPath)) {
            this.logger.info(`Using passphrase from key file ${keyPath}`);
            return readFileSync(keyPath, "utf-8").trim();
        }

        this.logger.info(`Generating new passphrase and saving to ${keyPath}`);
        const newPassphrase = randomBytes(32).toString("hex");
        mkdirSync(dirname(keyPath), { recursive: true });
        writeFileSync(keyPath, newPassphrase, { mode: 0o600 });
        return newPassphrase;
    }
}
