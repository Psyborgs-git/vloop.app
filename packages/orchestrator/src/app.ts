import { resolve, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { container as rootContainer } from "tsyringe";
import type { DependencyContainer, InjectionToken } from "tsyringe";
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
import type { Logger, WebSocketServerHandle, HealthServer } from "@orch/daemon";
import { DatabaseManager } from "@orch/shared/db";
import { TOKENS } from "@orch/shared";
import type {
	AppComponent,
	AppComponentContext,
	AppModuleExports,
	AppRoutesModule,
	AppHealthModule,
	AppToolsModule,
	AppToolRegistryContract,
	AppRouterContract,
	OrchestratorConfig,
} from "@orch/shared";
import { ComponentLifecycleManager } from "./lifecycle-manager.js";
import { HooksEventBus } from "@orch/shared/hooks-bus";
import { RuntimeServiceManager } from "./services/runtime-manager.js";
import { ProcessServiceProvider } from "./services/providers/process-provider.js";
import { PluginServiceProvider } from "./services/providers/plugin-provider.js";
import { BuiltinServiceProvider } from "./services/providers/builtin-provider.js";
import { createServicesHandler } from "./routes/services.js";
import { bootEventGateway } from "./event-gateway.js";
import type { EventGatewayHandle } from "./event-gateway.js";

interface SessionManagerLike {
	refresh(sessionId: string): unknown;
	listActive(): unknown;
}

export class OrchestratorApp {
	private config: OrchestratorConfig;
	private logger: Logger;
	private container: DependencyContainer;

	private lifecycle!: ComponentLifecycleManager;
	private componentContext?: AppComponentContext;
	private dbManager!: DatabaseManager;
	private wsHandle!: WebSocketServerHandle;
	private healthServer!: HealthServer;
	private shutdownController!: AbortController;
	private onReload!: (callback: () => void) => void;
	private eventGateway?: EventGatewayHandle;

	constructor(config: OrchestratorConfig) {
		this.config = config;
		this.logger = createLogger(config.daemon.log_level);
		this.container = rootContainer.createChildContainer();
	}

	public async start(): Promise<void> {
		try {
			await this.initPid();
			this.setupSignalHandlers();

			this.registerCore();

			// Load and register components in dependency order
			const components = await this.loadComponents();
			this.lifecycle = new ComponentLifecycleManager(this.logger);
			this.lifecycle.load(components);
			await this.lifecycle.registerAll(this.container);

			// Create gateway infrastructure
			const router = new Router(this.logger);
			this.healthServer = createHealthServer(
				this.config.network.health_port,
				this.config.network.bind_address,
				this.logger,
			);
			this.healthServer.registerSubsystem("database", () => ({
				name: "database",
				status: this.dbManager.isOpen() ? "healthy" : "unhealthy",
			}));

			// Resolve optional tool registry (registered by ai-agent if installed)
			const toolRegistry = this.tryResolve<AppToolRegistryContract>(
				TOKENS.ToolRegistry,
			);

			// Build injected context for component lifecycle
			this.componentContext = {
				container: this.container,
				healthRegistry: this.healthServer,
				shutdownSignal: this.shutdownController.signal,
				router: router as AppRouterContract,
				toolRegistry,
			};

			// Lifecycle: init → route discovery → start
			await this.lifecycle.initAll(this.componentContext);
			await this.discoverAutoRoutes(router, toolRegistry);
			await this.lifecycle.startAll(this.componentContext);

			// Gateway-level routes and servers
			this.setupRuntimeServiceManager(router);
			this.registerGatewayRoutes(router);
			await this.startGateway(router);

			// Boot the event-driven gateway (Redis pub/sub) if Redis is available
			await this.bootEventGateway();

			this.setupReloadHandler();

			await this.waitForShutdown();
			await this.shutdown();
		} catch (err) {
			this.logger.error({ err }, "Fatal error during startup");
			await this.shutdown();
			process.exit(1);
		}
	}

	private async initPid() {
		await killExistingDaemon(this.config.daemon.pid_file, this.logger);
		const pidWritten = await writePidFile(this.config.daemon.pid_file);
		if (!pidWritten) {
			this.logger.warn(
				{ pidFile: this.config.daemon.pid_file },
				"Could not write pid file",
			);
		}

		await killProcessesOnPorts(
			[
				this.config.network.health_port,
				this.config.network.ws_port,
				this.config.network.canvas_port,
				this.config.network.mcp_port,
			],
			this.logger,
		);

		process.on("exit", () => {
			try {
				removePidFile(this.config.daemon.pid_file);
			} catch {}
		});

		this.logger.info(
			{ config: { ...this.config, tls: "***", auth: "***" } },
			"Configuration loaded",
		);
	}

	private setupSignalHandlers(): void {
		const { shutdownController, onReload } = setupSignalHandlers(this.logger);
		this.shutdownController = shutdownController;
		this.onReload = onReload;
	}

	private registerCore(): void {
		this.container.register(TOKENS.Config, { useValue: this.config });
		this.container.register(TOKENS.Logger, { useValue: this.logger });

		const dbKeyPath = resolve("./data/keys/db.key");
		const dbPassphrase = this.getOrGeneratePassphrase(
			dbKeyPath,
			"ORCH_DB_PASSPHRASE",
		);

		this.dbManager = new DatabaseManager({
			engine: this.config.database.engine,
			path: resolve(this.config.database.path),
			passphrase: dbPassphrase,
		});

		const db = this.dbManager.open();
		this.logger.info(
			{ path: this.config.database.path },
			"Encrypted database opened",
		);

		this.container.register(TOKENS.DatabaseManager, {
			useValue: this.dbManager,
		});
		this.container.register(TOKENS.Database, { useValue: db });
		this.container.register(TOKENS.DatabaseOrm, {
			useValue: this.dbManager.getOrm(),
		});

		const vaultKeyPath = resolve("./data/keys/vault.key");
		const vaultPassphrase = this.getOrGeneratePassphrase(
			vaultKeyPath,
			"ORCH_VAULT_PASSPHRASE",
		);
		this.container.register(HooksEventBus, {
			useValue: new HooksEventBus(this.logger),
		});
		this.container.register(HooksEventBus, {
			useValue: new HooksEventBus(this.logger),
		});
		this.container.register(TOKENS.VaultPassphrase, {
			useValue: vaultPassphrase,
		});
	}

	private async loadComponents(): Promise<AppComponent[]> {
		const installedApps: string[] = this.config.applications?.installed ?? [];
		const components: AppComponent[] = [];

		for (const pkgName of installedApps) {
			this.logger.debug({ pkgName }, "Loading component module");
			const appModule = await import(`${pkgName}/app`);
			const component = this.extractAppComponent(pkgName, appModule);
			components.push(component);
		}

		return components;
	}

	private tryResolve<T>(token: InjectionToken<T>): T | undefined {
		try {
			return this.container.resolve<T>(token);
		} catch {
			return undefined;
		}
	}

	private async discoverAutoRoutes(
		router: Router,
		toolRegistry: AppToolRegistryContract | undefined,
	): Promise<void> {
		for (const component of this.lifecycle.getComponents()) {
			const pkgName = component.name;

			const routesModule = await this.importOptional<AppRoutesModule>(
				`${pkgName}/routes`,
				`${pkgName}/routes`,
			);
			if (routesModule?.registerRoutes) {
				routesModule.registerRoutes(
					this.container,
					router as AppRouterContract,
				);
				this.logger.debug({ app: pkgName }, "Routes discovered");
			}

			const healthModule = await this.importOptional<AppHealthModule>(
				`${pkgName}/health`,
				`${pkgName}/health`,
			);
			if (healthModule?.registerHealth) {
				healthModule.registerHealth(this.container, this.healthServer);
				this.logger.debug({ app: pkgName }, "Health checks discovered");
			}

			if (toolRegistry) {
				const toolsModule = await this.importOptional<AppToolsModule>(
					`${pkgName}/tools`,
					`${pkgName}/tools`,
				);
				if (toolsModule?.registerTools) {
					toolsModule.registerTools(
						this.container,
						toolRegistry as AppToolRegistryContract,
						router as AppRouterContract,
					);
					this.logger.debug({ app: pkgName }, "Tools discovered");
				}

				if (routesModule?.registerPackageTools) {
					routesModule.registerPackageTools(
						this.container,
						toolRegistry as AppToolRegistryContract,
						router as AppRouterContract,
					);
					this.logger.debug(
						{ app: pkgName },
						"Package tools discovered from routes module",
					);
				}
			}
		}
	}

	private async setupRuntimeServiceManager(router: Router): Promise<void> {
		const manager = new RuntimeServiceManager();

		// 1. Process Provider
		try {
			const { ProcessManager, ProcessLogManager } =
				await import("@orch/process");
			try {
				const processManager = this.container.resolve(ProcessManager);
				const processLogManager = this.container.resolve(ProcessLogManager);
				manager.register(
					new ProcessServiceProvider(processManager, processLogManager),
				);
			} catch (err) {
				console.error("Process providers not active", err);
			}
		} catch {}

		// 2. Plugin Provider
		try {
			const { PluginManager } = await import("@orch/plugin-manager");
			try {
				const pluginManager = this.container.resolve(PluginManager);
				manager.register(new PluginServiceProvider(pluginManager));
			} catch (err) {
				console.error("Plugin provider not active", err);
			}
		} catch {}

		// 3. Builtin Provider
		const builtinProvider = new BuiltinServiceProvider();
		builtinProvider.register({
			id: "orchestrator.db",
			name: "Database Manager",
			isCritical: true,
			actions: {
				inspect: () => ({ isOpen: this.dbManager.isOpen() }),
				stop: async () => {
					await this.dbManager.close();
				},
			},
		});
		manager.register(builtinProvider);

		// Register router handler
		router.register("services", createServicesHandler(manager));
	}

	private registerGatewayRoutes(router: Router): void {
		router.register("session", async (action, _payload, context) => {
			const authModule = await import("@orch/auth");
			const sessionManager = this.container.resolve<SessionManagerLike>(
				authModule.SessionManager,
			);

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

		// Secured lifecycle control plane (admin-only)
		router.register("lifecycle", async (action, payload, context) => {
			if (!context.roles?.includes("admin")) {
				throw new Error(
					"Unauthorized: admin role required for lifecycle operations",
				);
			}

			switch (action) {
				case "status":
					return { components: this.lifecycle.getAllStatuses() };
				case "restart": {
					const name = (payload as Record<string, unknown>)?.component;
					if (!name || typeof name !== "string") {
						throw new Error("component name is required");
					}
					if (!this.componentContext) {
						throw new Error("Component context not available");
					}
					await this.lifecycle.restartComponent(name, this.componentContext);
					return {
						restarted: name,
						status: this.lifecycle.getStatus(name),
					};
				}
				default:
					throw new Error(`Unknown lifecycle action: ${action}`);
			}
		});
	}

	private async startGateway(router: Router): Promise<void> {
		await this.healthServer.listen();

		this.wsHandle = createWebSocketServer(
			this.config,
			router,
			this.logger,
			this.shutdownController.signal,
			undefined,
		);

		this.healthServer.registerSubsystem("websocket", () => ({
			name: "websocket",
			status: "healthy",
			message: `${this.wsHandle.connectionCount()} active connections`,
		}));

		this.healthServer.markReady();
		this.logger.info("🚀 Orchestrator daemon is ready");
	}

	private async bootEventGateway(): Promise<void> {
		// Only start if Redis URL is configured
		const redisUrl = process.env['REDIS_URL'];
		if (!redisUrl) {
			this.logger.info(
				"Event gateway skipped (set REDIS_URL to enable event-driven mode)",
			);
			return;
		}

		try {
			// Create a JWT verifier that delegates to the auth module
			const jwtVerifier = {
				verify: async (token: string) => {
					try {
						const authModule = await import("@orch/auth");
						const verifier = this.container.resolve(authModule.JwtManager);
						const decoded = verifier.verify(token);
						const userId = decoded.sub ?? decoded.identity;
						if (!userId) {
							throw new Error("Token missing user identity");
						}
						return {
							userId,
							roles: decoded.roles ?? ["guest"],
						};
					} catch {
						throw new Error("Invalid token");
					}
				},
			};

			this.eventGateway = await bootEventGateway({
				redisUrl,
				jwtVerifier,
				gatewayPort: Number(process.env['GATEWAY_PORT'] ?? 9090),
			});

			this.healthServer.registerSubsystem("event-gateway", () => ({
				name: "event-gateway",
				status: "healthy",
				message: `${this.eventGateway?.gateway.connectionCount() ?? 0} gateway WebSocket connections`,
			}));

			this.logger.info(
				{ port: process.env['GATEWAY_PORT'] ?? 9090 },
				"🌉 Event gateway started",
			);
		} catch (err) {
			this.logger.warn(
				{ err },
				"Event gateway failed to start (Redis may be unavailable)",
			);
		}
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

	private async shutdown() {
		if (this.shutdownController && !this.shutdownController.signal.aborted) {
			this.shutdownController.abort();
		}

		if (this.lifecycle && this.componentContext) {
			try {
				await this.lifecycle.stopAll(this.componentContext);
				await this.lifecycle.cleanupAll(this.componentContext);
			} catch (err) {
				this.logger.error({ err }, "Error during component lifecycle shutdown");
			}
		}

		if (this.wsHandle) await this.wsHandle.close();
		if (this.eventGateway) await this.eventGateway.shutdown();
		if (this.healthServer) await this.healthServer.close();
		if (this.dbManager) this.dbManager.close();

		try {
			await removePidFile(this.config.daemon.pid_file);
		} catch {}

		this.logger.info("Orchestrator daemon stopped. Goodbye.");
	}

	private extractAppComponent(
		pkgName: string,
		appModule: AppModuleExports,
	): AppComponent {
		const isValidComponent = (value: unknown): value is AppComponent => {
			if (!value || typeof value !== "object") return false;
			const candidate = value as Partial<AppComponent>;
			return (
				typeof candidate.name === "string" &&
				typeof candidate.register === "function" &&
				typeof candidate.init === "function" &&
				typeof candidate.start === "function" &&
				typeof candidate.stop === "function" &&
				typeof candidate.cleanup === "function"
			);
		};

		const defaultExport = appModule.default;
		if (isValidComponent(defaultExport)) {
			return defaultExport;
		}

		if (isValidComponent(appModule)) {
			return appModule;
		}

		for (const key of Object.keys(appModule)) {
			const candidate = appModule[key];
			if (isValidComponent(candidate)) {
				return candidate;
			}
		}

		throw new Error(
			`Invalid app component in ${pkgName}/app: expected AppComponent with register/init/start/stop/cleanup`,
		);
	}

	private async importOptional<TModule extends object>(
		specifier: string,
		expectedInError: string,
	): Promise<TModule | undefined> {
		try {
			return (await import(specifier)) as TModule;
		} catch (err: unknown) {
			if (this.isMissingOptionalModule(err, specifier, expectedInError)) {
				return undefined;
			}
			throw err;
		}
	}

	private isMissingOptionalModule(
		err: unknown,
		specifier: string,
		expectedInError: string,
	): boolean {
		const moduleError = err as { code?: string; message?: string } | undefined;
		if (!moduleError || moduleError.code !== "ERR_MODULE_NOT_FOUND") {
			return false;
		}
		const msg = String(moduleError.message ?? "");
		const lastSegment = specifier.split("/").pop();
		if (!lastSegment) return false;

		return (
			msg.includes(expectedInError) ||
			msg.includes(specifier) ||
			msg.includes(`/dist/${lastSegment}.js`)
		);
	}

	private getOrGeneratePassphrase(keyPath: string, envVarName: string): string {
		if (process.env[envVarName]) {
			this.logger.info(
				`Using passphrase from environment variable ${envVarName}`,
			);
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
