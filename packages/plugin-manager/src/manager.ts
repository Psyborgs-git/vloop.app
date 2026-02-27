import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { Logger } from '@orch/daemon';
import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';
import { PluginStore, PluginRecord } from './store.js';
import { PluginDownloader } from './downloader.js';
import { PluginManifest, PluginManifestSchema } from './manifest.js';
import { PluginSandbox } from './sandbox.js';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import { DatabaseProvisioner } from '@orch/db-manager';
import { DbHostFunctions } from './host/db.js';

export class PluginManager {
    private store: PluginStore;
    private downloader: PluginDownloader;
    private pluginsDir: string;
    private sandboxes: Map<string, PluginSandbox> = new Map();

    constructor(
        db: BetterSqlite3.Database,
        private readonly dbProvisioner: DatabaseProvisioner,
        private readonly logger: Logger,
        dataDir: string = './data/plugins'
    ) {
        this.pluginsDir = resolvePath(dataDir);
        this.store = new PluginStore(db);
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
        const dbHost = new DbHostFunctions(
            this.dbProvisioner,
            record.id,
            record.granted_permissions,
            this.logger,
            record.db_id
        );
        const sandbox = new PluginSandbox(
            record.manifest,
            pluginDir,
            record.granted_permissions,
            this.logger,
            dbHost
        );
        this.sandboxes.set(record.id, sandbox);

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

        // Provision isolated DB if requested
        let dbId: string | undefined;
        if (grantedPermissions.includes('db:read') || grantedPermissions.includes('db:write')) {
            const result = await this.dbProvisioner.provision({
                workspaceId: 'plugin-' + id,
                description: `Private DB for plugin ${id}`
            });
            dbId = result.dbId;
            this.logger.info({ pluginId: id, dbId }, 'Provisioned private database');
        }

        this.store.install(manifest, grantedPermissions, dbId);
        this.logger.info({ id, permissions: grantedPermissions }, 'Plugin installed and enabled');

        // Immediately load it
        const record = this.store.get(id)!;
        await this.loadPlugin(record);
    }

    public list() {
        return this.store.list();
    }

    public async uninstall(id: string) {
        if (this.sandboxes.has(id)) {
            await this.sandboxes.get(id)?.close();
            this.sandboxes.delete(id);
        }
        this.store.uninstall(id);
        // TODO: Delete files from disk?
    }
}

function resolvePath(p: string): string {
    return p.startsWith('/') ? p : join(process.cwd(), p);
}
