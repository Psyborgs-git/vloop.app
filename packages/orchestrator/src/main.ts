/**
 * Orchestrator Daemon — Main Entrypoint.
 *
 * Boot sequence:
 * 1. Parse CLI args
 * 2. Load + validate config
 * 3. Init OrchestratorApp
 * 4. Start App
 */

import { loadConfig } from "@orch/daemon";
import { OrchestratorApp } from "./app.js";

async function main(): Promise<void> {
    // ── 1. Parse CLI args ────────────────────────────────────────────────
    const args = process.argv.slice(2);
    const configPath = args.includes("--config")
        ? args[args.indexOf("--config") + 1]
        : undefined;

    // ── 2. Load config ──────────────────────────────────────────────────
    const config = loadConfig(configPath);

    // ── 3. Start App ────────────────────────────────────────────────────
    const app = new OrchestratorApp(config);
    await app.start();
}

main().catch((err) => {
    console.error("Fatal error during startup:", err);
    process.exit(1);
});
