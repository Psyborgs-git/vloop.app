import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import type { Logger } from "@orch/daemon";
import type { PluginProcess, PluginRuntimeConfig } from "../types.js";

// TODO: Handle stdio IPC for Python (since IPC channel is node-specific)

export class PythonSandbox implements PluginProcess {
    private process?: ChildProcess;
    private config: PluginRuntimeConfig;
    private logger: Logger;
    private messageHandler?: (msg: any) => void;

    public status: "stopped" | "running" | "error" = "stopped";

    private buffer = "";

    constructor(config: PluginRuntimeConfig, logger: Logger) {
        this.config = config;
        this.logger = logger;
    }

    async start(): Promise<void> {
        if (this.status === "running") return;

        const entryPath = resolve(this.config.path, this.config.entry);

        // Assuming python3 is available in environment
        this.process = spawn("python3", [entryPath], {
            cwd: this.config.path,
            env: {
                ...process.env,
                ...this.config.env,
                ORCH_PLUGIN_ID: this.config.id,
                PYTHONUNBUFFERED: "1", // Ensure stdout is flushed immediately
            },
            stdio: ["pipe", "pipe", "pipe"], // Use stdio for communication
        });

        this.process.stdout?.on("data", (data) => {
            this.buffer += data.toString();

            let newlineIndex;
            while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
                const line = this.buffer.slice(0, newlineIndex).trim();
                this.buffer = this.buffer.slice(newlineIndex + 1);

                if (!line) continue;

                try {
                    // Try to parse as JSON-RPC / IPC message
                    const msg = JSON.parse(line);
                    if (msg && msg.type) {
                        if (this.messageHandler) this.messageHandler(msg);
                    } else {
                        // Regular output
                        this.logger.info({ pluginId: this.config.id, output: line }, "[Plugin Output]");
                    }
                } catch {
                    // Not JSON, treat as log
                    this.logger.info({ pluginId: this.config.id, output: line }, "[Plugin Output]");
                }
            }
        });

        this.process.stderr?.on("data", (data) => {
            this.logger.warn({ pluginId: this.config.id, output: data.toString().trim() }, "[Plugin Error]");
        });

        this.process.on("error", (err) => {
            this.logger.error({ err, pluginId: this.config.id }, "Plugin process error");
            this.status = "error";
        });

        this.process.on("exit", (code) => {
            this.logger.info({ pluginId: this.config.id, code }, "Plugin process exited");
            this.status = "stopped";
        });

        this.status = "running";
        this.logger.info({ pluginId: this.config.id }, "Plugin started (Python)");
    }

    async stop(): Promise<void> {
        if (this.process && this.status === "running") {
            this.process.kill();
            this.status = "stopped";
        }
    }

    send(message: any): void {
        if (this.process && this.process.stdin) {
            const payload = JSON.stringify(message) + "\n";
            this.process.stdin.write(payload);
        } else {
            this.logger.warn({ pluginId: this.config.id }, "Cannot send message, plugin stdin not available");
        }
    }

    onMessage(callback: (msg: any) => void): void {
        this.messageHandler = callback;
    }
}
