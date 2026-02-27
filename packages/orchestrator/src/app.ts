import { resolve, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
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
import {
    JwtValidator,
    SessionManager,
    PolicyEngine,
    AuditLogger,
    createAuthMiddleware,
    UserManager,
    JwtProviderManager,
    createAuthHandler,
} from "@orch/auth";
import { VaultCrypto, VaultStore, createVaultHandler } from "@orch/vault";
import {
    DockerClient,
    ImageManager,
    ContainerManager,
    LogStreamer as ContainerLogStreamer,
    ContainerMonitor,
    createContainerHandler,
} from "@orch/container";
import {
    ProcessManager,
    CronScheduler,
    ProcessLogManager,
    createProcessHandler,
} from "@orch/process";
import type { ScheduledJob } from "@orch/process";
import {
    DatabaseProvisioner,
    DatabasePool,
    createDatabaseHandler,
    ExternalDatabaseRegistry,
} from "@orch/db-manager";
import {
    AgentSandbox,
    ToolRegistry,
    AgentOrchestrator,
    createAgentHandler,
    BrowserTool,
    AIConfigStore,
    createAgentSearchTool,
} from "@orch/ai-agent";
import {
    TerminalManager,
    TerminalProfileManager,
    SessionLogger,
    TerminalSessionStore,
    createTerminalHandler,
} from "@orch/terminal";
import { createMediaHandler } from "@orch/media";
import { PluginManager, createPluginHandler } from "@orch/plugin-manager";
import { createMcpHttpHandler } from "./mcp-server.js";
import { registerAITools } from "./ai-tools.js";

export class OrchestratorApp {
    private config: any;
    private logger: Logger;

    // Subsystems
    private dbManager!: DatabaseManager;
    private vaultCrypto!: VaultCrypto;
    private vaultStore!: VaultStore;
    private userManager!: UserManager;
    private sessionManager!: SessionManager;
    private policyEngine!: PolicyEngine;
    private auditLogger!: AuditLogger;
    private jwtProviderManager!: JwtProviderManager;
    private jwtValidator!: JwtValidator;

    // Feature subsystems
    private containerMonitor!: ContainerMonitor;
    private processManager!: ProcessManager;
    private cronScheduler!: CronScheduler;
    private processLogManager!: ProcessLogManager;
    private terminalManager!: TerminalManager;
    private sessionLogger!: SessionLogger;
    private dbPool!: DatabasePool;
    private pluginManager!: PluginManager;
    private wsHandle!: any;
    private healthServer!: any;

    // Lifecycle
    private shutdownController!: AbortController;
    private onReload!: (callback: () => void) => void;

    constructor(config: any) {
        this.config = config;
        this.logger = createLogger(config.daemon.log_level);
    }

    public async start(): Promise<void> {
        try {
            await this.initPid();
            this.setupSignalHandlers();

            const db = await this.initDatabase();
            await this.initVault(db);
            await this.initAuth(db);

            const {
                imageManager,
                containerManager,
                containerLogStreamer
            } = this.initContainerSubsystem();

            this.initProcessSubsystem();

            const {
                terminalProfileManager,
                terminalSessionStore
            } = this.initTerminalSubsystem(db);

            const {
                dbProvisioner,
                externalDbRegistry
            } = this.initDatabaseSubsystem(db);

            this.initPluginSubsystem(db, dbProvisioner);

            const {
                agentOrchestrator,
                toolRegistry,
                aiConfigStore
            } = this.initAgentSubsystem(db);

            const router = this.setupRouter(
                db,
                containerManager,
                imageManager,
                containerLogStreamer,
                terminalProfileManager,
                terminalSessionStore,
                dbProvisioner,
                externalDbRegistry,
                agentOrchestrator,
                aiConfigStore,
                toolRegistry
            );

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
        // make sure only one daemon instance is running and write our PID
        await killExistingDaemon(this.config.daemon.pid_file, this.logger);
        const pidWritten = await writePidFile(this.config.daemon.pid_file);
        if (!pidWritten) {
            this.logger.warn(
                { pidFile: this.config.daemon.pid_file },
                "Could not write pid file (permission denied) — proceeding anyway",
            );
        }

        // as a fallback, kill any process listening on our ports (for dev/restart scenarios)
        await killProcessesOnPorts(
            [this.config.network.health_port, this.config.network.ws_port],
            this.logger,
        );

        // ensure pid file is removed on exit no matter what
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

    private async initDatabase() {
        const dbKeyPath = resolve("./data/keys/db.key");
        const dbPassphrase = this.getOrGeneratePassphrase(dbKeyPath, "ORCH_DB_PASSPHRASE");

        this.dbManager = new DatabaseManager({
            path: resolve(this.config.database.path),
            passphrase: dbPassphrase,
        });

        const db = this.dbManager.open();
        this.logger.info({ path: this.config.database.path }, "Encrypted database opened");
        return db;
    }

    private async initVault(db: any) {
        const vaultKeyPath = resolve("./data/keys/vault.key");
        const vaultPassphrase = this.getOrGeneratePassphrase(vaultKeyPath, "ORCH_VAULT_PASSPHRASE");

        this.vaultCrypto = new VaultCrypto();
        this.vaultStore = new VaultStore(
            db,
            this.vaultCrypto,
            this.config.vault.max_secret_versions,
        );
        await this.vaultStore.init(vaultPassphrase);
        this.logger.info("Vault initialized and unlocked");
    }

    private async initAuth(db: any) {
        this.userManager = new UserManager(db);
        await this.userManager.initDefaultUser();
        this.logger.info("User manager initialized with default admin if needed");

        this.jwtProviderManager = new JwtProviderManager(db);
        this.logger.info("JWT provider manager initialized");

        this.jwtValidator = new JwtValidator(this.jwtProviderManager);
        this.logger.info("JWT validator initialized");

        this.sessionManager = new SessionManager(db, {
            idleTimeoutSecs: this.config.auth.session_idle_timeout_secs,
            maxLifetimeSecs: this.config.auth.session_max_lifetime_secs,
            maxSessionsPerIdentity: this.config.auth.max_sessions_per_identity,
        });
        this.logger.info("Session manager initialized");

        this.policyEngine = new PolicyEngine();
        this.policyEngine.load(resolve("./config/policies.toml"));
        this.logger.info({ roles: this.policyEngine.roleNames() }, "RBAC policies loaded");

        this.auditLogger = new AuditLogger(db);
        this.logger.info("Audit logger initialized");
    }

    private initContainerSubsystem() {
        const dockerClient = new DockerClient();
        const imageManager = new ImageManager(dockerClient);
        const containerManager = new ContainerManager(dockerClient);
        const containerLogStreamer = new ContainerLogStreamer(dockerClient);
        this.containerMonitor = new ContainerMonitor(
            dockerClient,
            containerManager,
            { logger: this.logger },
        );
        return { imageManager, containerManager, containerLogStreamer };
    }

    private initProcessSubsystem() {
        this.processManager = new ProcessManager(this.logger);
        this.cronScheduler = new CronScheduler(this.logger);
        this.processLogManager = new ProcessLogManager();

        // Hook up cron executor to spawn processes
        this.cronScheduler.setExecutor(async (job: ScheduledJob) => {
            const managed = this.processManager.start({
                id: `cron - ${job.id} -${Date.now()} `,
                command: job.command,
                args: job.args,
                cwd: job.cwd,
                env: job.env,
                restartPolicy: "never",
                maxRestarts: 0,
            });

            // Wait for it to finish to return the exit code
            return new Promise((resolve) => {
                const check = setInterval(() => {
                    const processInfo = this.processManager.get(managed.id);
                    if (
                        processInfo.status === "stopped" ||
                        processInfo.status === "failed"
                    ) {
                        clearInterval(check);
                        resolve({ exitCode: processInfo.lastExitCode ?? 1 });
                    }
                }, 1000);
            });
        });
    }

    private initTerminalSubsystem(db: any) {
        this.terminalManager = new TerminalManager(this.logger);
        const terminalProfileManager = new TerminalProfileManager(db, this.logger);
        const terminalSessionStore = new TerminalSessionStore(db, this.logger);
        this.sessionLogger = new SessionLogger({
            logDir: resolve("./data/terminal-logs"),
            logger: this.logger,
            sessionStore: terminalSessionStore,
        });
        return { terminalProfileManager, terminalSessionStore };
    }

    private initDatabaseSubsystem(db: any) {
        const dbProvisioner = new DatabaseProvisioner(
            resolve("./data/workspaces"),
            this.vaultStore,
            this.logger,
        );
        this.dbPool = new DatabasePool(dbProvisioner, this.logger);
        const externalDbRegistry = new ExternalDatabaseRegistry(db, this.vaultStore, this.logger);
        return { dbProvisioner, externalDbRegistry };
    }

    private initPluginSubsystem(db: any, dbProvisioner: DatabaseProvisioner) {
        this.pluginManager = new PluginManager(db, dbProvisioner, this.logger);
        this.pluginManager.start().catch(err => {
            this.logger.error({ err }, "Failed to start plugins");
        });
    }

    private initAgentSubsystem(db: any) {
        const agentSandbox = new AgentSandbox(this.logger);
        const toolRegistry = new ToolRegistry(this.logger);
        const aiConfigStore = new AIConfigStore(db, this.logger);
        aiConfigStore.migrate();

        const vaultGet = async (ref: string): Promise<string | undefined> => {
            try {
                const secret = this.vaultStore.get(ref);
                return secret?.value;
            } catch {
                return undefined;
            }
        };

        const agentOrchestrator = new AgentOrchestrator(
            toolRegistry,
            agentSandbox,
            this.logger,
            aiConfigStore,
            vaultGet,
        );

        return { agentOrchestrator, toolRegistry, aiConfigStore };
    }

    private setupRouter(
        db: any,
        containerManager: ContainerManager,
        imageManager: ImageManager,
        containerLogStreamer: ContainerLogStreamer,
        terminalProfileManager: TerminalProfileManager,
        terminalSessionStore: TerminalSessionStore,
        dbProvisioner: DatabaseProvisioner,
        externalDbRegistry: ExternalDatabaseRegistry,
        agentOrchestrator: AgentOrchestrator,
        aiConfigStore: AIConfigStore,
        toolRegistry: ToolRegistry
    ) {
        const router = new Router(this.logger);

        // Auth middleware (applies to all handlers)
        const authMiddleware = createAuthMiddleware(
            this.sessionManager,
            this.policyEngine,
            this.auditLogger,
        );
        router.use(authMiddleware);

        // Register Handlers
        router.register("auth", createAuthHandler(this.sessionManager, this.userManager, this.jwtValidator, this.jwtProviderManager));
        router.register("vault", createVaultHandler(this.vaultStore));
        router.register(
            "container",
            createContainerHandler(
                imageManager,
                containerManager,
                containerLogStreamer,
            ),
        );
        router.register(
            "process",
            createProcessHandler(this.processManager, this.cronScheduler, this.processLogManager),
        );
        router.register(
            "schedule",
            createProcessHandler(this.processManager, this.cronScheduler, this.processLogManager),
        );
        router.register(
            "terminal",
            createTerminalHandler(this.terminalManager, terminalProfileManager, this.sessionLogger, terminalSessionStore),
        );
        router.register("media", createMediaHandler(resolve("./data/media")));
        router.register("db", createDatabaseHandler(dbProvisioner, this.dbPool, this.dbManager, externalDbRegistry));
        router.register("agent", createAgentHandler(agentOrchestrator, aiConfigStore));
        router.register("plugin", createPluginHandler(this.pluginManager));

        // Session topic handler
        router.register("session", async (action, payload, context) => {
            switch (action) {
                case "info":
                    return {
                        session_id: context.sessionId,
                        identity: context.identity,
                        roles: context.roles,
                    };
                case "refresh":
                    if (!context.sessionId) throw new Error("No session");
                    return this.sessionManager.refresh(
                        context.sessionId as import("@orch/shared").SessionId,
                    );
                case "list":
                    return { sessions: this.sessionManager.listActive() };
                default:
                    throw new Error(`Unknown session action: ${action} `);
            }
        });

        // Health topic handler
        router.register("health", async (action) => {
            switch (action) {
                case "check":
                    return { status: "healthy", timestamp: new Date().toISOString() };
                default:
                    throw new Error(`Unknown health action: ${action} `);
            }
        });

        // Register tools
        this.registerTools(toolRegistry, router, aiConfigStore);

        return router;
    }

    private registerTools(toolRegistry: ToolRegistry, router: Router, aiConfigStore: AIConfigStore) {
        // Register Browser Tool
        const browserTool = new BrowserTool(this.logger);
        toolRegistry.register({
            ...browserTool.definition,
            execute: async (args: any) => await browserTool.execute(args),
        });

        // Register Process Tool
        toolRegistry.register({
            name: "spawn_process",
            description: "Spawns a new background process or command.",
            parameters: {
                type: "object",
                properties: {
                    id: { type: "string", description: "Unique identifier for the process" },
                    command: { type: "string", description: "The executable command" },
                    args: { type: "array", items: { type: "string" }, description: "Command arguments" },
                    cwd: { type: "string", description: "Working directory" },
                    restartPolicy: {
                        type: "string",
                        enum: ["always", "on-failure", "never"],
                        description: "Restart policy",
                    },
                },
                required: ["id", "command"],
            },
            execute: async (args: any, context?: import('@orch/daemon').HandlerContext) => {
                if (!context) throw new Error("Context required for tool execution");

                const request = {
                    id: `tool-${Date.now()}`,
                    topic: 'process',
                    action: 'spawn',
                    payload: args,
                    meta: {
                        timestamp: new Date().toISOString(),
                        session_id: context.sessionId,
                        trace_id: context.request.meta.trace_id
                    }
                };

                const response = await router.dispatch(request, context.logger);
                if (response.type === 'error') {
                    return { success: false, error: response.payload };
                }
                return { success: true, message: "Process " + args.id + " started." };
            },
        });

        // Register Container Tools
        toolRegistry.register({
            name: "spawn_container",
            description: "Creates and starts a Docker container.",
            parameters: {
                type: "object",
                properties: {
                    name: { type: "string", description: "Name of the container" },
                    image: { type: "string", description: "Docker image to use (e.g. alpine:latest)" },
                    cmd: { type: "array", items: { type: "string" }, description: 'Command to run (e.g. ["ls", "-la"])' },
                },
                required: ["name", "image"],
            },
            execute: async (args: any, context?: import('@orch/daemon').HandlerContext) => {
                if (!context) throw new Error("Context required for tool execution");

                const request = {
                    id: `tool-${Date.now()}`,
                    topic: 'container',
                    action: 'create',
                    payload: args,
                    meta: {
                        timestamp: new Date().toISOString(),
                        session_id: context.sessionId,
                        trace_id: context.request.meta.trace_id
                    }
                };

                const response = await router.dispatch(request, context.logger);
                if (response.type === 'error') {
                    return { success: false, error: response.payload };
                }

                // Start it
                const startReq = {
                    ...request,
                    action: 'start',
                    payload: { name: args.name }
                };
                await router.dispatch(startReq, context.logger);

                return {
                    success: true,
                    message: "Container " + args.name + " started.",
                    containerId: (response.payload as any).id,
                };
            },
        });

        toolRegistry.register({
            name: "inspect_container",
            description: "Gets low-level information on a Docker container.",
            parameters: {
                type: "object",
                properties: {
                    name: { type: "string", description: "Container name or ID" },
                },
                required: ["name"],
            },
            execute: async (args: any, context?: import('@orch/daemon').HandlerContext) => {
                if (!context) throw new Error("Context required for tool execution");

                const request = {
                    id: `tool-${Date.now()}`,
                    topic: 'container',
                    action: 'inspect',
                    payload: args,
                    meta: {
                        timestamp: new Date().toISOString(),
                        session_id: context.sessionId,
                        trace_id: context.request.meta.trace_id
                    }
                };

                const response = await router.dispatch(request, context.logger);
                if (response.type === 'error') {
                    return { success: false, error: response.payload };
                }
                return { success: true, info: response.payload };
            },
        });

        // Register Terminal Tool
        toolRegistry.register({
            name: "terminal_execute",
            description: "Executes a command in a managed terminal session.",
            parameters: {
                type: "object",
                properties: {
                    sessionId: { type: "string", description: "Existing terminal session ID (optional)" },
                    command: { type: "string", description: "Command text to send to the terminal" },
                    shell: { type: "string", description: "Shell executable for new sessions" },
                    cwd: { type: "string", description: "Working directory for new sessions" },
                },
                required: ["command"],
            },
            execute: async (args: any, context?: import('@orch/daemon').HandlerContext) => {
                if (!context) throw new Error("Context required for tool execution");

                const sessionId = (args.sessionId as string | undefined)
                    ?? `tool-term-${Date.now()}`;

                if (!args.sessionId) {
                    const spawnRequest = {
                        id: `tool-${Date.now()}-spawn`,
                        topic: 'terminal',
                        action: 'spawn',
                        payload: {
                            sessionId,
                            shell: args.shell,
                            cwd: args.cwd,
                        },
                        meta: {
                            timestamp: new Date().toISOString(),
                            session_id: context.sessionId,
                            trace_id: context.request.meta.trace_id,
                        },
                    };

                    const spawnResponse = await router.dispatch(spawnRequest, context.logger);
                    if (spawnResponse.type === 'error') {
                        return { success: false, error: spawnResponse.payload };
                    }
                }

                const writeRequest = {
                    id: `tool-${Date.now()}-write`,
                    topic: 'terminal',
                    action: 'write',
                    payload: {
                        sessionId,
                        data: `${args.command}\n`,
                    },
                    meta: {
                        timestamp: new Date().toISOString(),
                        session_id: context.sessionId,
                        trace_id: context.request.meta.trace_id,
                    },
                };

                const writeResponse = await router.dispatch(writeRequest, context.logger);
                if (writeResponse.type === 'error') {
                    return { success: false, error: writeResponse.payload };
                }

                return {
                    success: true,
                    sessionId,
                    message: `Command sent to terminal session ${sessionId}`,
                };
            },
        });

        // Register built-in AI tools
        toolRegistry.register(createAgentSearchTool(aiConfigStore));

        registerAITools(toolRegistry, router);
    }

    private async startServers(router: Router, toolRegistry: ToolRegistry) {
        // Start health server
        this.healthServer = createHealthServer(
            this.config.network.health_port,
            this.config.network.bind_address,
            this.logger,
        );
        this.registerHealthChecks();
        await this.healthServer.listen();

        // Start WebSocket server
        const mcpHttpHandler = createMcpHttpHandler(toolRegistry, this.sessionManager, this.logger);

        this.wsHandle = createWebSocketServer(
            this.config,
            router,
            this.logger,
            this.shutdownController.signal,
            mcpHttpHandler
        );

        this.healthServer.registerSubsystem("websocket", () => ({
            name: "websocket",
            status: "healthy",
            message: `${this.wsHandle.connectionCount()} active connections`,
        }));

        // Mark as ready
        this.healthServer.markReady();
        this.logger.info("🚀 Orchestrator daemon is ready");

        // Start background loops
        this.cronScheduler.start();
        this.containerMonitor
            .start()
            .catch((err: unknown) =>
                this.logger.warn({ err }, "Failed to start container monitor"),
            );
    }

    private registerHealthChecks() {
        this.healthServer.registerSubsystem("database", () => ({
            name: "database",
            status: this.dbManager.isOpen() ? "healthy" : "unhealthy",
        }));

        this.healthServer.registerSubsystem("vault", () => ({
            name: "vault",
            status: this.vaultCrypto.isUnlocked() ? "healthy" : "unhealthy",
        }));

        this.healthServer.registerSubsystem("docker", () => {
            return {
                name: "docker",
                status: this.containerMonitor.isRunning() ? "healthy" : "degraded",
                message: this.containerMonitor.isRunning()
                    ? "Docker connected and monitoring"
                    : "Docker monitor inactive",
            };
        });

        this.healthServer.registerSubsystem("process", () => {
            return {
                name: "process",
                status: "healthy",
                message: `${this.processManager.list().length} processes, ${this.cronScheduler.list().length} schedules`,
            };
        });

        this.healthServer.registerSubsystem("terminal", () => {
            return {
                name: "terminal",
                status: "healthy",
                message: `${this.terminalManager.list().length} active terminal sessions`,
            };
        });
    }

    private setupReloadHandler() {
        this.onReload(() => {
            try {
                this.policyEngine.reload(resolve("./config/policies.toml"));
                this.logger.info("RBAC policies reloaded");
            } catch (err) {
                this.logger.error({ err }, "Failed to reload policies");
            }
        });
    }

    private async waitForShutdown() {
        await new Promise<void>((resolve) => {
            this.shutdownController.signal.addEventListener("abort", () => resolve());
        });
        this.logger.info("Shutting down...");
    }

    private async cleanup() {
        // Graceful cleanup
        if (this.processManager) await this.processManager.shutdownAll();
        if (this.cronScheduler) this.cronScheduler.stop();
        if (this.containerMonitor) this.containerMonitor.stop();
        if (this.terminalManager) this.terminalManager.shutdownAll();
        if (this.sessionLogger) this.sessionLogger.shutdownAll();
        if (this.dbPool) this.dbPool.shutdownAll();
        if (this.pluginManager) await this.pluginManager.stop();

        if (this.wsHandle) await this.wsHandle.close();
        if (this.healthServer) await this.healthServer.close();
        if (this.vaultCrypto) this.vaultCrypto.zeroize();
        if (this.dbManager) this.dbManager.close();
        if (this.sessionManager) this.sessionManager.cleanup();

        // remove pid file before exiting
        try {
            await removePidFile(this.config.daemon.pid_file);
        } catch { }

        this.logger.info("Orchestrator daemon stopped. Goodbye.");
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
