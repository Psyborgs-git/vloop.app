import { resolve, join, dirname } from "node:path";
import { mkdirSync, existsSync, writeFileSync, rmSync, readFileSync, renameSync, readdirSync, lstatSync } from "node:fs";
import { v4 as uuidv4 } from "uuid";
import fetch from "node-fetch";
import unzipper from "unzipper";

import type { Logger } from "@orch/daemon";
import type { VaultStore } from "@orch/vault";
import type { PluginRecord, PluginManifest, PluginRequest, PluginResponse, PluginEvent } from "./types.js";
import { PluginManifestSchema } from "./types.js";
import { PluginStore } from "./store.js";
import { HookService } from "./hook-service.js";
import { NodeSandbox } from "./runtime/node-sandbox.js";
import { PythonSandbox } from "./runtime/python-sandbox.js";

// Error Types
class PluginError extends Error {
    constructor(message: string, public code: string) {
        super(message);
    }
}

export class PluginManager {
    private logger: Logger;
    private store: PluginStore;
    private hookService: HookService;
    private vaultStore: VaultStore;
    private pluginDir: string;
    private runningPlugins: Map<string, NodeSandbox | PythonSandbox> = new Map();

    constructor(
        logger: Logger,
        store: PluginStore,
        hookService: HookService,
        vaultStore: VaultStore,
        pluginDir: string = "./plugins"
    ) {
        this.logger = logger;
        this.store = store;
        this.hookService = hookService;
        this.vaultStore = vaultStore;
        this.pluginDir = resolve(pluginDir);

        if (!existsSync(this.pluginDir)) {
            mkdirSync(this.pluginDir, { recursive: true });
        }
    }

    /**
     * Installs a plugin from a URL (zip archive).
     * Extracts it, validates manifest, and adds to store as PENDING.
     */
    async install(url: string): Promise<PluginRecord> {
        this.logger.info({ url }, "Installing plugin from URL");

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to download plugin: ${response.statusText}`);

            // Temporary extraction path
            const tempId = uuidv4();
            const tempPath = join(this.pluginDir, ".temp", tempId);
            mkdirSync(tempPath, { recursive: true });

            // Pipe download to unzip
            await new Promise((resolve, reject) => {
                if (!response.body) return reject(new Error("No response body"));
                response.body.pipe(unzipper.Extract({ path: tempPath }))
                    .on('close', resolve)
                    .on('error', reject);
            });

            // Find manifest (handles nested folders in zip)
            let pluginRoot = tempPath;
            let manifestPath = join(pluginRoot, "plugin.json");

            if (!existsSync(manifestPath)) {
                // Check if it's inside a single subdirectory (common zip behavior)
                const items = readdirSync(tempPath);
                if (items.length === 1 && lstatSync(join(tempPath, items[0])).isDirectory()) {
                    pluginRoot = join(tempPath, items[0]);
                    manifestPath = join(pluginRoot, "plugin.json");
                }
            }

            if (!existsSync(manifestPath)) {
                throw new Error("Invalid plugin: plugin.json missing");
            }

            const rawManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
            const parseResult = PluginManifestSchema.safeParse(rawManifest);

            if (!parseResult.success) {
                throw new Error(`Invalid plugin manifest: ${parseResult.error.message}`);
            }

            const manifest = parseResult.data;

            // Move to final location
            // Security: manifest.id is validated by Zod schema to be alphanumeric-dash only
            const installPath = join(this.pluginDir, manifest.id);
            if (existsSync(installPath)) {
                // If exists, maybe update? For now error.
                throw new Error(`Plugin ${manifest.id} already installed`);
            }

            renameSync(pluginRoot, installPath);
            // Cleanup temp parent if we moved a subdir
            if (pluginRoot !== tempPath) {
                rmSync(tempPath, { recursive: true, force: true });
            }

            // Add to store
            this.store.add(manifest);

            return this.store.get(manifest.id)!;

        } catch (err: any) {
            this.logger.error({ err }, "Plugin installation failed");
            throw new PluginError(err.message, "INSTALL_FAILED");
        }
    }

    /**
     * Approves a plugin and grants permissions.
     */
    async approve(id: string, permissions: string[]): Promise<void> {
        const plugin = this.store.get(id);
        if (!plugin) throw new PluginError("Plugin not found", "NOT_FOUND");

        // Validate permissions against manifest
        const requested = plugin.manifest.permissions || [];
        const invalid = permissions.filter(p => !requested.includes(p));

        if (invalid.length > 0) {
            this.logger.warn({ id, invalid }, "Granting unrequested permissions");
        }

        this.store.grantPermissions(id, permissions);
        this.store.updateStatus(id, "active");

        // Auto-start
        await this.start(id);
    }

    /**
     * Starts a plugin process.
     */
    async start(id: string): Promise<void> {
        const plugin = this.store.get(id);
        if (!plugin) throw new PluginError("Plugin not found", "NOT_FOUND");
        if (plugin.status !== "active") throw new PluginError("Plugin not active", "NOT_ACTIVE");

        const pluginPath = join(this.pluginDir, plugin.id);

        // Provision Database
        const dbPath = join(this.pluginDir, "data", `${plugin.id}.db`);
        mkdirSync(dirname(dbPath), { recursive: true });

        // We pass the DB path to the plugin.
        // The plugin is responsible for connecting (sqlite).
        // For security, we might want to provision a specific user/password if using postgres,
        // but since we are using sqlite per plugin, file path is enough.

        let sandbox: NodeSandbox | PythonSandbox;
        const config = {
            id: plugin.id,
            path: pluginPath,
            entry: plugin.manifest.entry,
            permissions: plugin.permissions,
            env: {
                ORCH_PLUGIN_DB_PATH: dbPath,
            }
        };

        if (plugin.manifest.runtime === "node") {
            sandbox = new NodeSandbox(config, this.logger);
        } else if (plugin.manifest.runtime === "python") {
            sandbox = new PythonSandbox(config, this.logger);
        } else {
            throw new PluginError("Unsupported runtime", "INVALID_RUNTIME");
        }

        // Setup IPC
        sandbox.onMessage(async (msg: any) => {
            await this.handlePluginMessage(id, msg, sandbox);
        });

        await sandbox.start();
        this.runningPlugins.set(id, sandbox);

        // Register hooks
        if (plugin.manifest.hooks) {
            for (const hook of plugin.manifest.hooks) {
                // Enforce permission for static hooks
                // A plugin must request `hook:read:<topic>` or `hook:read:*` to listen.
                const allowed =
                    plugin.permissions.includes(`hook:read:${hook}`) ||
                    plugin.permissions.includes("hook:read:*");

                if (allowed) {
                    this.hookService.register(hook, (payload) => {
                        sandbox.send({ type: "event", topic: hook, data: payload });
                    });
                } else {
                    this.logger.warn({ pluginId: id, hook }, "Plugin requested hook without permission, skipping");
                }
            }
        }
    }

    async stop(id: string): Promise<void> {
        const sandbox = this.runningPlugins.get(id);
        if (sandbox) {
            await sandbox.stop();
            this.runningPlugins.delete(id);
        }
    }

    /**
     * Handles messages from the plugin (API calls).
     */
    private async handlePluginMessage(pluginId: string, msg: any, sandbox: any) {
        if (msg.type === "request") {
            const req = msg as PluginRequest;
            try {
                const result = await this.executePluginRequest(pluginId, req);
                sandbox.send({
                    type: "response",
                    requestId: req.id,
                    result
                } as PluginResponse);
            } catch (err: any) {
                sandbox.send({
                    type: "response",
                    requestId: req.id,
                    error: err.message
                } as PluginResponse);
            }
        } else if (msg.type === "event") {
             // Plugin emitting an event
             const evt = msg as PluginEvent;
             // Check permission?
             this.hookService.emitHook(evt.topic, evt.data);
        }
    }

    public async executePluginRequest(pluginId: string, req: PluginRequest): Promise<any> {
        const plugin = this.store.get(pluginId);
        if (!plugin) throw new Error("Plugin not found");

        const hasPermission = (perm: string) => plugin.permissions.includes(perm) || plugin.permissions.includes("*");

        // --- Core API Exposure ---

        // 1. Vault Access
        if (req.action.startsWith("vault.")) {
            if (req.action === "vault.get") {
                const key = req.args.key;

                // Granular Permission Check
                // 1. Check for global vault access: `vault:read` or `vault:*`
                // 2. Check for specific key access: `vault:read:keyname`

                const allowed =
                    hasPermission("vault:read") ||
                    hasPermission("vault:*") ||
                    hasPermission(`vault:read:${key}`);

                if (!allowed) {
                    throw new Error(`Permission denied for vault key: ${key}`);
                }

                const secret = this.vaultStore.get(key);
                return secret ? secret.value : null;
            }
        }

        // 2. Database Access (Plugin's own DB)
        // Plugins should access their DB directly via `ORCH_PLUGIN_DB_PATH` using `better-sqlite3` or similar.
        // We do NOT proxy SQL queries over IPC for now to avoid complexity and serialization overhead.

        // 3. System Hooks (Subscription)
        if (req.action === "hooks.subscribe") {
            const topic = req.args.topic;
            // Enforce granular permission: `hook:read:<topic>`
            const allowed =
                hasPermission(`hook:read:${topic}`) ||
                hasPermission("hook:read:*");

            if (!allowed) {
                throw new Error(`Permission denied for hook subscription: ${topic}`);
            }

             this.hookService.register(topic, (payload) => {
                const sandbox = this.runningPlugins.get(pluginId);
                sandbox?.send({ type: "event", topic, data: payload });
            });
            return true;
        }

        throw new Error(`Unknown action: ${req.action}`);
    }

    list() {
        return this.store.list();
    }
}
