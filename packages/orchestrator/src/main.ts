/**
 * Orchestrator Daemon — Main Entrypoint.
 *
 * Boot sequence:
 * 1. Parse CLI args
 * 2. Load + validate config
 * 3. Init logging
 * 4. Open encrypted SQLite DB
 * 5. Init vault (derive MEK, verify sentinel)
 * 6. Init auth (session manager, RBAC policy engine, audit logger)
 * 7. Create router + register handlers + middleware
 * 8. Start WebSocket server (TLS)
 * 9. Start health HTTP server
 * 10. Await shutdown signal → graceful drain
 */

import { resolve, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import {
    loadConfig,
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
} from "@orch/ai-agent";
import {
    TerminalManager,
    TerminalProfileManager,
    SessionLogger,
    TerminalSessionStore,
    createTerminalHandler,
} from "@orch/terminal";

function getOrGeneratePassphrase(keyPath: string, envVarName: string, logger: any): string {
    if (process.env[envVarName]) {
        logger.info(`Using passphrase from environment variable ${envVarName}`);
        return process.env[envVarName]!;
    }

    if (existsSync(keyPath)) {
        logger.info(`Using passphrase from key file ${keyPath}`);
        return readFileSync(keyPath, "utf-8").trim();
    }

    logger.info(`Generating new passphrase and saving to ${keyPath}`);
    const newPassphrase = randomBytes(32).toString("hex");
    mkdirSync(dirname(keyPath), { recursive: true });
    writeFileSync(keyPath, newPassphrase, { mode: 0o600 });
    return newPassphrase;
}

async function main(): Promise<void> {
    //

    // ── 1. Parse CLI args ────────────────────────────────────────────────
    const args = process.argv.slice(2);
    const configPath = args.includes("--config")
        ? args[args.indexOf("--config") + 1]
        : undefined;

    // ── 2. Load config ──────────────────────────────────────────────────
    const config = loadConfig(configPath);

    // ── 3. Init logging ─────────────────────────────────────────────────
    const logger = createLogger(config.daemon.log_level);

    // make sure only one daemon instance is running and write our PID
    await killExistingDaemon(config.daemon.pid_file, logger);
    const pidWritten = await writePidFile(config.daemon.pid_file);
    if (!pidWritten) {
        logger.warn(
            { pidFile: config.daemon.pid_file },
            "Could not write pid file (permission denied) — proceeding anyway",
        );
    }

    // as a fallback, kill any process listening on our ports (for dev/restart scenarios)
    await killProcessesOnPorts(
        [config.network.health_port, config.network.ws_port],
        logger,
    );

    // ensure pid file is removed on exit no matter what
    process.on("exit", () => {
        try {
            removePidFile(config.daemon.pid_file);
        } catch { }
    });
    logger.info(
        { config: { ...config, tls: "***", auth: "***" } },
        "Configuration loaded",
    );

    // ── 4. Setup signal handlers ────────────────────────────────────────
    const { shutdownController, onReload } = setupSignalHandlers(logger);

    // ── 5. Open encrypted database ──────────────────────────────────────
    const dbKeyPath = resolve("./data/keys/db.key");
    const dbPassphrase = getOrGeneratePassphrase(dbKeyPath, "ORCH_DB_PASSPHRASE", logger);

    const dbManager = new DatabaseManager({
        path: resolve(config.database.path),
        passphrase: dbPassphrase,
    });

    const db = dbManager.open();
    logger.info({ path: config.database.path }, "Encrypted database opened");

    // ── 6. Init vault ──────────────────────────────────────────────────
    const vaultKeyPath = resolve("./data/keys/vault.key");
    const vaultPassphrase = getOrGeneratePassphrase(vaultKeyPath, "ORCH_VAULT_PASSPHRASE", logger);

    const vaultCrypto = new VaultCrypto();
    const vaultStore = new VaultStore(
        db,
        vaultCrypto,
        config.vault.max_secret_versions,
    );
    await vaultStore.init(vaultPassphrase);
    logger.info("Vault initialized and unlocked");

    // ── 7. Init auth ───────────────────────────────────────────────────
    const userManager = new UserManager(db);
    await userManager.initDefaultUser();
    logger.info("User manager initialized with default admin if needed");

    const jwtProviderManager = new JwtProviderManager(db);
    logger.info("JWT provider manager initialized");

    const jwtValidator = new JwtValidator(jwtProviderManager);
    logger.info("JWT validator initialized");

    const sessionManager = new SessionManager(db, {
        idleTimeoutSecs: config.auth.session_idle_timeout_secs,
        maxLifetimeSecs: config.auth.session_max_lifetime_secs,
        maxSessionsPerIdentity: config.auth.max_sessions_per_identity,
    });
    logger.info("Session manager initialized");

    const policyEngine = new PolicyEngine();
    policyEngine.load(resolve("./config/policies.toml"));
    logger.info({ roles: policyEngine.roleNames() }, "RBAC policies loaded");

    const auditLogger = new AuditLogger(db);
    logger.info("Audit logger initialized");

    // ── 7.5. Init container & process subsystems ───────────────────────
    const dockerClient = new DockerClient();
    const imageManager = new ImageManager(dockerClient);
    const containerManager = new ContainerManager(dockerClient);
    const containerLogStreamer = new ContainerLogStreamer(dockerClient);
    const containerMonitor = new ContainerMonitor(
        dockerClient,
        containerManager,
        { logger },
    );

    const processManager = new ProcessManager(logger);
    const cronScheduler = new CronScheduler(logger);
    const processLogManager = new ProcessLogManager();

    const terminalManager = new TerminalManager(logger);
    const terminalProfileManager = new TerminalProfileManager(db, logger);
    const terminalSessionStore = new TerminalSessionStore(db, logger);
    const sessionLogger = new SessionLogger({
        logDir: resolve("./data/terminal-logs"),
        logger,
        sessionStore: terminalSessionStore,
    });

    // ── 7.6. Init database & AI agent subsystems ───────────────────────
    const dbProvisioner = new DatabaseProvisioner(
        resolve("./data/workspaces"),
        vaultStore,
        logger,
    );
    const dbPool = new DatabasePool(dbProvisioner, logger);
    const externalDbRegistry = new ExternalDatabaseRegistry(db, vaultStore, logger);

    // ── 8. Create router + register handlers ───────────────────────────
    // We initialize the router early so tools can dispatch through it
    const router = new Router(logger);

    // Auth middleware (applies to all handlers)
    const authMiddleware = createAuthMiddleware(
        sessionManager,
        policyEngine,
        auditLogger,
    );
    router.use(authMiddleware);

    const agentSandbox = new AgentSandbox(logger);
    const toolRegistry = new ToolRegistry(logger);

    // Register Browser Tool
    const browserTool = new BrowserTool(logger);
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
                id: {
                    type: "string",
                    description: "Unique identifier for the process",
                },
                command: { type: "string", description: "The executable command" },
                args: {
                    type: "array",
                    items: { type: "string" },
                    description: "Command arguments",
                },
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
                image: {
                    type: "string",
                    description: "Docker image to use (e.g. alpine:latest)",
                },
                cmd: {
                    type: "array",
                    items: { type: "string" },
                    description: 'Command to run (e.g. ["ls", "-la"])',
                },
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
                sessionId: {
                    type: "string",
                    description: "Existing terminal session ID (optional)",
                },
                command: {
                    type: "string",
                    description: "Command text to send to the terminal",
                },
                shell: {
                    type: "string",
                    description: "Shell executable for new sessions",
                },
                cwd: {
                    type: "string",
                    description: "Working directory for new sessions",
                },
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

    // AI Configuration Store
    const aiConfigStore = new AIConfigStore(db, logger);
    aiConfigStore.migrate();

    const vaultGet = async (ref: string): Promise<string | undefined> => {
        try {
            const secret = vaultStore.get(ref);
            return secret?.value;
        } catch {
            return undefined;
        }
    };

    const agentOrchestrator = new AgentOrchestrator(
        toolRegistry,
        agentSandbox,
        logger,
        aiConfigStore,
        vaultGet,
    );

    // Hook up cron executor to spawn processes
    cronScheduler.setExecutor(async (job: ScheduledJob) => {
        const managed = processManager.start({
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
                const processInfo = processManager.get(managed.id);
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

    // Start background loops
    cronScheduler.start();
    containerMonitor
        .start()
        .catch((err: unknown) =>
            logger.warn({ err }, "Failed to start container monitor"),
        );


    // Register topic handlers
    router.register("auth", createAuthHandler(sessionManager, userManager, jwtValidator, jwtProviderManager));
    router.register("vault", createVaultHandler(vaultStore));
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
        createProcessHandler(processManager, cronScheduler, processLogManager),
    );
    router.register(
        "schedule",
        createProcessHandler(processManager, cronScheduler, processLogManager),
    );
    router.register(
        "terminal",
        createTerminalHandler(terminalManager, terminalProfileManager, sessionLogger, terminalSessionStore),
    );
    router.register("db", createDatabaseHandler(dbProvisioner, dbPool, dbManager, externalDbRegistry));
    router.register("agent", createAgentHandler(agentOrchestrator, aiConfigStore));

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
                return sessionManager.refresh(
                    context.sessionId as import("@orch/shared").SessionId,
                );
            case "list":
                return { sessions: sessionManager.listActive() };
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

    // ── 9. Start health server ─────────────────────────────────────────

    const healthServer = createHealthServer(
        config.network.health_port,
        config.network.bind_address,
        logger,
    );

    healthServer.registerSubsystem("database", () => ({
        name: "database",
        status: dbManager.isOpen() ? "healthy" : "unhealthy",
    }));

    healthServer.registerSubsystem("vault", () => ({
        name: "vault",
        status: vaultCrypto.isUnlocked() ? "healthy" : "unhealthy",
    }));

    healthServer.registerSubsystem("docker", () => {
        // ContainerMonitor periodically runs and updates availability.
        // We can just rely on the monitor running status.
        return {
            name: "docker",
            status: containerMonitor.isRunning() ? "healthy" : "degraded",
            message: containerMonitor.isRunning()
                ? "Docker connected and monitoring"
                : "Docker monitor inactive",
        };
    });

    healthServer.registerSubsystem("process", () => {
        return {
            name: "process",
            status: "healthy",
            message: `${processManager.list().length} processes, ${cronScheduler.list().length} schedules`,
        };
    });

    healthServer.registerSubsystem("terminal", () => {
        return {
            name: "terminal",
            status: "healthy",
            message: `${terminalManager.list().length} active terminal sessions`,
        };
    });

    await healthServer.listen();

    // ── 10. Start WebSocket server ─────────────────────────────────────

    const wsHandle = createWebSocketServer(
        config,
        router,
        logger,
        shutdownController.signal,
    );

    healthServer.registerSubsystem("websocket", () => ({
        name: "websocket",
        status: "healthy",
        message: `${wsHandle.connectionCount()} active connections`,
    }));

    // Mark as ready
    healthServer.markReady();
    logger.info("🚀 Orchestrator daemon is ready");

    // ── Config reload handler ──────────────────────────────────────────
    onReload(() => {
        try {
            policyEngine.reload(resolve("./config/policies.toml"));
            logger.info("RBAC policies reloaded");
        } catch (err) {
            logger.error({ err }, "Failed to reload policies");
        }
    });

    // ── Await shutdown ─────────────────────────────────────────────────
    await new Promise<void>((resolve) => {
        shutdownController.signal.addEventListener("abort", () => resolve());
    });

    logger.info("Shutting down...");

    // Graceful cleanup
    await processManager.shutdownAll();
    cronScheduler.stop();
    containerMonitor.stop();
    terminalManager.shutdownAll();
    sessionLogger.shutdownAll();
    dbPool.shutdownAll();

    await wsHandle.close();
    await healthServer.close();
    vaultCrypto.zeroize();
    dbManager.close();
    sessionManager.cleanup();

    // remove pid file before exiting
    try {
        await removePidFile(config.daemon.pid_file);
    } catch { }

    logger.info("Orchestrator daemon stopped. Goodbye.");
    process.exit(0);
}

main().catch((err) => {
    console.error("Fatal error during startup:", err);
    process.exit(1);
});
