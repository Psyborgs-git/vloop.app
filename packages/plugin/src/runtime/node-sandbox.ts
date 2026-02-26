import { fork, type ChildProcess } from "node:child_process";
import { resolve, dirname } from "node:path";
import type { Logger } from "@orch/daemon";
import type { PluginProcess, PluginRuntimeConfig } from "../types.js";

export class NodeSandbox implements PluginProcess {
    private process?: ChildProcess;
    private config: PluginRuntimeConfig;
    private logger: Logger;
    private messageHandler?: (msg: any) => void;

    public status: "stopped" | "running" | "error" = "stopped";

    constructor(config: PluginRuntimeConfig, logger: Logger) {
        this.config = config;
        this.logger = logger;
    }

    async start(): Promise<void> {
        if (this.status === "running") return;

        const entryPath = resolve(this.config.path, this.config.entry);

        this.process = fork(entryPath, [], {
            cwd: this.config.path,
            env: {
                ...process.env,
                ...this.config.env,
                ORCH_PLUGIN_ID: this.config.id,
            },
            stdio: ["pipe", "pipe", "pipe", "ipc"],
        });

        this.process.on("message", (msg) => {
            if (this.messageHandler) {
                this.messageHandler(msg);
            }
        });

        this.process.on("error", (err) => {
            this.logger.error({ err, pluginId: this.config.id }, "Plugin process error");
            this.status = "error";
        });

        this.process.on("exit", (code) => {
            this.logger.info({ pluginId: this.config.id, code }, "Plugin process exited");
            this.status = "stopped";
        });

        this.process.stdout?.on("data", (data) => {
            this.logger.info({ pluginId: this.config.id, output: data.toString().trim() }, "[Plugin Output]");
        });

        this.process.stderr?.on("data", (data) => {
            this.logger.warn({ pluginId: this.config.id, output: data.toString().trim() }, "[Plugin Error]");
        });

        this.status = "running";
        this.logger.info({ pluginId: this.config.id }, "Plugin started (Node.js)");
    }

    async stop(): Promise<void> {
        if (this.process && this.status === "running") {
            this.process.kill();
            this.status = "stopped";
        }
    }

    send(message: any): void {
        if (this.process && this.process.connected) {
            this.process.send(message);
        } else {
            this.logger.warn({ pluginId: this.config.id }, "Cannot send message, plugin not connected");
        }
    }

    onMessage(callback: (msg: any) => void): void {
        this.messageHandler = callback;
    }
}
