import { join } from 'node:path';
import { existsSync, readFileSync, rmSync, readdirSync, mkdirSync, cpSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { Logger } from '@orch/daemon';
import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';
import type { RootDatabaseOrm } from '@orch/shared/db';
import { PluginStore } from './store.js';
import type { PluginRecord } from './store.js';
import { PluginDownloader } from './downloader.js';
import { PluginManifestSchema } from './manifest.js';
import type { PluginManifest } from './manifest.js';
import { PluginSandbox } from './sandbox.js';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import { SettingsHostFunctions } from './host/settings.js';
import { VaultHostFunctions } from './host/vault.js';
import { EventsHostFunctions } from './host/events.js';
import { TaskHostFunctions } from './host/task.js';
import type { VaultStore } from '@orch/vault';
import type { HooksEventBus } from '@orch/shared/hooks-bus';

export class PluginManager {
    private store: PluginStore;
    private downloader: PluginDownloader;
    private pluginsDir: string;
    private sandboxes: Map<string, PluginSandbox> = new Map();

    constructor(
        db: BetterSqlite3.Database,
        orm: RootDatabaseOrm,
        private readonly logger: Logger,
        dataDir: string = './data/plugins',
        private readonly vaultStore?: VaultStore,
        private readonly eventBus?: HooksEventBus
    ) {
        this.pluginsDir = resolvePath(dataDir);
        this.store = new PluginStore(db, orm);
        this.downloader = new PluginDownloader(this.pluginsDir, logger);
    }

    /**
     * Start all enabled plugins.
     */
    public async start(): Promise<void> {
        const plugins = this.store.list().filter(p => p.enabled);
        this.logger.info({ count: plugins.length }, 'Starting plugins...');

        for (const record of plugins) {
            try {
                await this.loadPlugin(record);
            } catch (err) {
                this.logger.error({ err, pluginId: record.id }, 'Failed to start plugin');
            }
        }
    }

    /**
     * Stop all plugins.
     */
    public async stop(): Promise<void> {
        for (const [id, sandbox] of this.sandboxes) {
            await sandbox.close();
            this.logger.info({ pluginId: id }, 'Plugin stopped');
        }
        this.sandboxes.clear();
    }

    /**
     * Load a single plugin into memory.
     */
    private async loadPlugin(record: PluginRecord) {
        if (this.sandboxes.has(record.id)) return;

        const pluginDir = join(this.pluginsDir, record.id);
        const settingsHost = new SettingsHostFunctions(
            this.store,
            record.id,
            record.granted_permissions,
            this.logger
        );

        // VaultHostFunctions — wired when a vault store is available
        const vaultHost = this.vaultStore
            ? new VaultHostFunctions(this.vaultStore, record.id, record.granted_permissions, this.logger)
            : undefined;
        const taskHost = record.manifest.task
            ? new TaskHostFunctions(
                this.eventBus,
                record.manifest,
                record.id,
                record.granted_permissions,
                this.logger,
                Boolean(vaultHost)
            )
            : undefined;

        // EventsHostFunctions — late-bind the WASM callback so we can reference the sandbox
        // after it is created, avoiding a circular construction dependency.
        // The no-op placeholder is replaced with the real handler after sandbox creation (line ~114).
        let eventsCallback: (topic: string, payload: string) => void = () => {};
        const eventsHost = this.eventBus
            ? new EventsHostFunctions(
                this.eventBus,
                record.id,
                record.granted_permissions,
                this.logger,
                (topic, payload) => eventsCallback(topic, payload)
            )
            : undefined;

        const sandbox = new PluginSandbox(
            record.manifest,
            pluginDir,
            record.granted_permissions,
            this.logger,
            settingsHost,
            vaultHost,
            eventsHost,
            taskHost
        );
        this.sandboxes.set(record.id, sandbox);

        // Wire the late-bound callback: deliver incoming events to the plugin's on_event handler
        if (eventsHost) {
            eventsCallback = (topic: string, payload: string) => {
                sandbox.call('on_event', JSON.stringify({ topic, payload })).catch((err) => {
                    this.logger.error({ err, pluginId: record.id }, 'Failed to deliver event to plugin');
                });
            };
        }

        // Optional: Call an 'on_start' function if it exists?
        // For now, we just load it.
        this.logger.info({ pluginId: record.id }, 'Plugin loaded');

        if (await sandbox.call('on_start').catch(() => false)) {
            this.logger.info({ pluginId: record.id }, 'Plugin on_start executed');
        }
    }

    public async prepareInstall(urlOrPath: string): Promise<PluginManifest> {
        const { manifest } = await this.downloader.download(urlOrPath);

        const existing = this.store.get(manifest.id);
        if (existing) {
             throw new OrchestratorError(ErrorCode.ALREADY_EXISTS, `Plugin ${manifest.id} is already installed.`);
        }

        return manifest;
    }

    public async commitInstall(id: string, grantedPermissions: string[]): Promise<void> {
        const pluginDir = join(this.pluginsDir, id);
        const manifestPath = join(pluginDir, 'plugin.json');

        if (!existsSync(manifestPath)) {
            throw new OrchestratorError(ErrorCode.NOT_FOUND, `Plugin ${id} not found in staging. Run install first.`);
        }

        const manifestJson = readFileSync(manifestPath, 'utf-8');
        const manifest = PluginManifestSchema.parse(JSON.parse(manifestJson));

        this.store.install(manifest, grantedPermissions);
        this.logger.info({ id, permissions: grantedPermissions }, 'Plugin installed and enabled');

        // Immediately load it
        const record = this.store.get(id)!;
        await this.loadPlugin(record);
    }

    /**
     * Cancel a staged installation and remove downloaded files.
     */
    public cancelInstall(id: string): void {
        const pluginDir = join(this.pluginsDir, id);
        if (existsSync(pluginDir)) {
            rmSync(pluginDir, { recursive: true, force: true });
            this.logger.info({ id }, 'Cancelled staged plugin installation, files removed');
        }
    }

    public list() {
        return this.store.list();
    }

    /**
     * Scan a directory for plugin subdirectories and auto-install any that are
     * not yet registered in the database. Used to bootstrap bundled extensions
     * (e.g. the `extensions/` folder) on daemon startup.
     */
    public async autoInstallFromDir(dir: string): Promise<void> {
        const resolvedDir = resolvePath(dir);
        if (!existsSync(resolvedDir)) {
            this.logger.debug({ dir: resolvedDir }, 'Extensions directory not found, skipping auto-install');
            return;
        }

        const entries = readdirSync(resolvedDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const manifestPath = join(resolvedDir, entry.name, 'plugin.json');
            if (!existsSync(manifestPath)) continue;

            try {
                const manifest = PluginManifestSchema.parse(
                    JSON.parse(readFileSync(manifestPath, 'utf-8')),
                );

                if (this.store.get(manifest.id)) {
                    this.logger.debug({ id: manifest.id }, 'Extension already installed, skipping');
                    continue;
                }

                const destDir = join(this.pluginsDir, manifest.id);
                mkdirSync(destDir, { recursive: true });
                cpSync(join(resolvedDir, entry.name), destDir, { recursive: true, force: true });

                // Grant all permissions declared in the manifest for bundled extensions
                this.store.install(manifest, manifest.permissions);
                this.logger.info({ id: manifest.id }, 'Auto-installed bundled extension');
            } catch (err) {
                this.logger.warn({ err, name: entry.name }, 'Failed to auto-install extension, skipping');
            }
        }
    }

    public async uninstall(id: string) {
        if (this.sandboxes.has(id)) {
            await this.sandboxes.get(id)?.close();
            this.sandboxes.delete(id);
        }

        const pluginDir = join(this.pluginsDir, id);
        await rm(pluginDir, { recursive: true, force: true });
        this.logger.info({ id }, 'Plugin files removed');

        this.store.uninstall(id);
    }
}

function resolvePath(p: string): string {
    return p.startsWith('/') ? p : join(process.cwd(), p);
}
