import { runOrchestrator } from "./app.js";

runOrchestrator().catch((err) => {
    console.error("Fatal error during startup:", err);
    process.exit(1);
});
