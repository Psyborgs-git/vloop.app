import { OrchestratorClient } from '../client.js';

export interface PluginManifest {
    id: string;
    name: string;
    version: string;
    description?: string;
    author?: string;
    entrypoint: string;
    task?: string;
    host_features?: Record<string, boolean>;
    permissions: string[];
}

export interface InstalledPlugin {
    id: string;
    enabled: boolean;
    manifest: PluginManifest;
    granted_permissions: string[];
    installed_at: string;
    db_id?: string;
}

export interface PluginListResult {
    items: InstalledPlugin[];
}

export class PluginClient {
    constructor(private client: OrchestratorClient) {}

    /** Fetch list of all installed plugins. */
    public async list(): Promise<PluginListResult> {
        return this.client.request('plugin', 'list', {});
    }

    /**
     * Stage a plugin for installation. Accepts a URL, absolute path to a
     * directory, or absolute path to a plugin.json file.
     * Returns the manifest for user review — call grant() to complete.
     */
    public async install(urlOrPath: string): Promise<PluginManifest> {
        return this.client.request('plugin', 'install', { url: urlOrPath });
    }

    /** Commit a staged plugin install — grants the specified permissions. */
    public async grant(id: string, permissions: string[]): Promise<{ success: boolean; message: string }> {
        return this.client.request('plugin', 'grant', { id, permissions });
    }

    /** Discard a staged (not yet granted) plugin install and remove its files. */
    public async cancel(id: string): Promise<{ success: boolean }> {
        return this.client.request('plugin', 'cancel', { id });
    }

    /** Uninstall a plugin entirely — stops sandbox, removes files and DB record. */
    public async uninstall(id: string): Promise<{ success: boolean }> {
        return this.client.request('plugin', 'uninstall', { id });
    }
}
