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

import { resolve } from 'node:path';
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
} from '@orch/daemon';
import { DatabaseManager } from '@orch/shared/db';
import { JwtValidator, SessionManager, PolicyEngine, AuditLogger, createAuthMiddleware } from '@orch/auth';
import { VaultCrypto, VaultStore, createVaultHandler } from '@orch/vault';
import { DockerClient, ImageManager, ContainerManager, LogStreamer as ContainerLogStreamer, ContainerMonitor, createContainerHandler } from '@orch/container';
import { ProcessManager, CronScheduler, ProcessLogManager, createProcessHandler } from '@orch/process';
import type { ScheduledJob } from '@orch/process';
import { DatabaseProvisioner, DatabasePool, createDatabaseHandler } from '@orch/db-manager';
import { AgentSandbox, ToolRegistry, AgentOrchestrator, createAgentHandler, BrowserTool } from '@orch/ai-agent';

async function main(): Promise<void> {
    // ── 1. Parse CLI args ────────────────────────────────────────────────

    const args = process.argv.slice(2);
    const configPath = args.includes('--config')
        ? args[args.indexOf('--config') + 1]
        : undefined;

    // ── 2. Load config ──────────────────────────────────────────────────

    const config = loadConfig(configPath);

    // ── 3. Init logging ─────────────────────────────────────────────────

    const logger = createLogger(config.daemon.log_level);
    // make sure only one daemon instance is running and write our PID
    await killExistingDaemon(config.daemon.pid_file, logger);
    const pidWritten = await writePidFile(config.daemon.pid_file);
    if (!pidWritten) {
        logger.warn({ pidFile: config.daemon.pid_file }, 'Could not write pid file (permission denied) — proceeding anyway');
    }

    // as a fallback, kill any process listening on our ports (for dev/restart scenarios)
    await killProcessesOnPorts([config.network.health_port, config.network.ws_port], logger);

    // ensure pid file is removed on exit no matter what
    process.on('exit', () => {
        try {
            removePidFile(config.daemon.pid_file);
        } catch {}
    });
    logger.info({ config: { ...config, tls: '***', auth: '***' } }, 'Configuration loaded');

    // ── 4. Setup signal handlers ────────────────────────────────────────

    const { shutdownController, onReload } = setupSignalHandlers(logger);

    // ── 5. Open encrypted database ──────────────────────────────────────

    const dbPassphrase = process.env['ORCH_DB_PASSPHRASE'];
    if (!dbPassphrase) {
        logger.fatal('ORCH_DB_PASSPHRASE environment variable is required');
        process.exit(1);
    }

    const dbManager = new DatabaseManager({
        path: resolve(config.database.path),
        passphrase: dbPassphrase,
    });

    const db = dbManager.open();
    logger.info({ path: config.database.path }, 'Encrypted database opened');

    // ── 6. Init vault ──────────────────────────────────────────────────

    const vaultPassphrase = process.env['ORCH_VAULT_PASSPHRASE'];
    if (!vaultPassphrase) {
        logger.fatal('ORCH_VAULT_PASSPHRASE environment variable is required');
        process.exit(1);
    }

    const vaultCrypto = new VaultCrypto();
    const vaultStore = new VaultStore(db, vaultCrypto, config.vault.max_secret_versions);
    await vaultStore.init(vaultPassphrase);
    logger.info('Vault initialized and unlocked');

    // ── 7. Init auth ───────────────────────────────────────────────────

    const jwtValidator = new JwtValidator({
        publicKeyPath: resolve(config.auth.jwt_public_key_path),
        algorithm: config.auth.jwt_algorithm,
        issuer: config.auth.jwt_issuer,
        audience: config.auth.jwt_audience,
    });
    await jwtValidator.init();
    logger.info('JWT validator initialized');

    const sessionManager = new SessionManager(db, {
        idleTimeoutSecs: config.auth.session_idle_timeout_secs,
        maxLifetimeSecs: config.auth.session_max_lifetime_secs,
        maxSessionsPerIdentity: config.auth.max_sessions_per_identity,
    });
    logger.info('Session manager initialized');

    const policyEngine = new PolicyEngine();
    policyEngine.load(resolve('./config/policies.toml'));
    logger.info({ roles: policyEngine.roleNames() }, 'RBAC policies loaded');

    const auditLogger = new AuditLogger(db);
    logger.info('Audit logger initialized');

    // ── 7.5. Init container & process subsystems ───────────────────────

    const dockerClient = new DockerClient();
    const imageManager = new ImageManager(dockerClient);
    const containerManager = new ContainerManager(dockerClient);
    const containerLogStreamer = new ContainerLogStreamer(dockerClient);
    const containerMonitor = new ContainerMonitor(dockerClient, containerManager, { logger });

    const processManager = new ProcessManager(logger);
    const cronScheduler = new CronScheduler(logger);
    const processLogManager = new ProcessLogManager();

    // ── 7.6. Init database & AI agent subsystems ───────────────────────

    const dbProvisioner = new DatabaseProvisioner(resolve('./data/workspaces'), vaultStore, logger);
    const dbPool = new DatabasePool(dbProvisioner, logger);

    const agentSandbox = new AgentSandbox(logger);
    const toolRegistry = new ToolRegistry(logger);

    // Register Browser Tool
    const browserTool = new BrowserTool(logger);
    toolRegistry.register({
        ...browserTool.definition,
        execute: async (args: any) => await browserTool.execute(args)
    });

    // Register Process Tool
    toolRegistry.register({
        name: 'spawn_process',
        description: 'Spawns a new background process or command.',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Unique identifier for the process' },
                command: { type: 'string', description: 'The executable command' },
                args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
                cwd: { type: 'string', description: 'Working directory' },
                restartPolicy: { type: 'string', enum: ['always', 'on-failure', 'never'], description: 'Restart policy' }
            },
            required: ['id', 'command']
        },
        execute: async (args: any) => {
            try {
                processManager.start({
                    id: args.id,
                    command: args.command,
                    args: args.args || [],
                    cwd: args.cwd || process.cwd(),
                    restartPolicy: args.restartPolicy || 'never',
                    env: {}
                });
                return { success: true, message: 'Process ' + args.id + ' started.' };
            } catch (err: any) {
                return { success: false, error: err.message };
            }
        }
    });

    // Register Container Tools
    toolRegistry.register({
        name: 'spawn_container',
        description: 'Creates and starts a Docker container.',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Name of the container' },
                image: { type: 'string', description: 'Docker image to use (e.g. alpine:latest)' },
                cmd: { type: 'array', items: { type: 'string' }, description: 'Command to run (e.g. ["ls", "-la"])' }
            },
            required: ['name', 'image']
        },
        execute: async (args: any) => {
            try {
                const res = await containerManager.create({
                    name: args.name,
                    image: args.image,
                    cmd: args.cmd || []
                });
                await containerManager.start(args.name);
                return { success: true, message: 'Container ' + args.name + ' started.', containerId: res.id };
            } catch (err: any) {
                return { success: false, error: err.message };
            }
        }
    });

    toolRegistry.register({
        name: 'inspect_container',
        description: 'Gets low-level information on a Docker container.',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Container name or ID' }
            },
            required: ['name']
        },
        execute: async (args: any) => {
            try {
                const info = await containerManager.inspect(args.name);
                return { success: true, info };
            } catch (err: any) {
                return { success: false, error: err.message };
            }
        }
    });

    const agentOrchestrator = new AgentOrchestrator(toolRegistry, agentSandbox, logger);

    // Hook up cron executor to spawn processes
    cronScheduler.setExecutor(async (job: ScheduledJob) => {
        const managed = processManager.start({
            id: `cron - ${job.id} -${Date.now()} `,
            command: job.command,
            args: job.args,
            cwd: job.cwd,
            env: job.env,
            restartPolicy: 'never',
            maxRestarts: 0,
        });

        // Wait for it to finish to return the exit code
        return new Promise((resolve) => {
            const check = setInterval(() => {
                const processInfo = processManager.get(managed.id);
                if (processInfo.status === 'stopped' || processInfo.status === 'failed') {
                    clearInterval(check);
                    resolve({ exitCode: processInfo.lastExitCode ?? 1 });
                }
            }, 1000);
        });
    });

    // Start background loops
    cronScheduler.start();
    containerMonitor.start().catch((err: unknown) => logger.warn({ err }, 'Failed to start container monitor'));

    // ── 8. Create router + register handlers ───────────────────────────

    const router = new Router(logger);

    // Auth middleware (applies to all handlers)
    const authMiddleware = createAuthMiddleware(sessionManager, policyEngine, auditLogger);
    router.use(authMiddleware);

    // Register topic handlers
    router.register('vault', createVaultHandler(vaultStore));
    router.register('container', createContainerHandler(imageManager, containerManager, containerLogStreamer));
    router.register('process', createProcessHandler(processManager, cronScheduler, processLogManager));
    router.register('schedule', createProcessHandler(processManager, cronScheduler, processLogManager));
    router.register('db', createDatabaseHandler(dbProvisioner, dbPool));
    router.register('agent', createAgentHandler(agentOrchestrator));

    // Session topic handler
    router.register('session', async (action, payload, context) => {
        switch (action) {
            case 'info':
                return {
                    session_id: context.sessionId,
                    identity: context.identity,
                    roles: context.roles,
                };
            case 'refresh':
                if (!context.sessionId) throw new Error('No session');
                return sessionManager.refresh(context.sessionId as import('@orch/shared').SessionId);
            case 'list':
                return { sessions: sessionManager.listActive() };
            default:
                throw new Error(`Unknown session action: ${action} `);
        }
    });

    // Health topic handler
    router.register('health', async (action) => {
        switch (action) {
            case 'check':
                return { status: 'healthy', timestamp: new Date().toISOString() };
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

    healthServer.registerSubsystem('database', () => ({
        name: 'database',
        status: dbManager.isOpen() ? 'healthy' : 'unhealthy',
    }));

    healthServer.registerSubsystem('vault', () => ({
        name: 'vault',
        status: vaultCrypto.isUnlocked() ? 'healthy' : 'unhealthy',
    }));

    healthServer.registerSubsystem('docker', () => {
        // ContainerMonitor periodically runs and updates availability.
        // We can just rely on the monitor running status.
        return {
            name: 'docker',
            status: containerMonitor.isRunning() ? 'healthy' : 'degraded',
            message: containerMonitor.isRunning() ? 'Docker connected and monitoring' : 'Docker monitor inactive',
        };
    });

    healthServer.registerSubsystem('process', () => {
        return {
            name: 'process',
            status: 'healthy',
            message: `${processManager.list().length} processes, ${cronScheduler.list().length} schedules`,
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

    healthServer.registerSubsystem('websocket', () => ({
        name: 'websocket',
        status: 'healthy',
        message: `${wsHandle.connectionCount()} active connections`,
    }));

    // Mark as ready
    healthServer.markReady();
    logger.info('🚀 Orchestrator daemon is ready');

    // ── Config reload handler ──────────────────────────────────────────

    onReload(() => {
        try {
            policyEngine.reload(resolve('./config/policies.toml'));
            logger.info('RBAC policies reloaded');
        } catch (err) {
            logger.error({ err }, 'Failed to reload policies');
        }
    });

    // ── Await shutdown ─────────────────────────────────────────────────

    await new Promise<void>((resolve) => {
        shutdownController.signal.addEventListener('abort', () => resolve());
    });

    logger.info('Shutting down...');

    // Graceful cleanup
    await processManager.shutdownAll();
    cronScheduler.stop();
    containerMonitor.stop();
    dbPool.shutdownAll();

    await wsHandle.close();
    await healthServer.close();
    vaultCrypto.zeroize();
    dbManager.close();
    sessionManager.cleanup();

    // remove pid file before exiting
    try {
        await removePidFile(config.daemon.pid_file);
    } catch {}

    logger.info('Orchestrator daemon stopped. Goodbye.');
    process.exit(0);
}

main().catch((err) => {
    console.error('Fatal error during startup:', err);
    process.exit(1);
});
