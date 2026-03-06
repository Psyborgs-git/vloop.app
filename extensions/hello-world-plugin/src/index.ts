// AssemblyScript entrypoint for a minimal "Hello World" plugin.
//
// All host functions are imported from the `extism:host/user` namespace,
// which is the namespace registered by PluginSandbox in @orch/plugin-manager.
// The pointer type used here is `usize` (u32 on wasm32).

// ── Host function imports ──────────────────────────────────────────────────

/** Log a message at INFO level via the orchestrator's structured logger. */
@external("extism:host/user", "log_info")
declare function log_info(ptr: usize): void;

/** Log a message at ERROR level via the orchestrator's structured logger. */
@external("extism:host/user", "log_error")
declare function log_error(ptr: usize): void;

// ── AssemblyScript runtime helper ─────────────────────────────────────────

/**
 * Allocates `str` in Wasm linear memory and returns its address.
 * Provided by the AssemblyScript runtime; declared here so the compiler
 * knows about it. The `usize` return keeps the types consistent.
 */
declare function __newString(str: string): usize;

// ── Exported lifecycle functions ──────────────────────────────────────────

/**
 * Called once by PluginManager immediately after the plugin is loaded.
 * Use this function for one-time initialization work.
 */
export function on_start(): void {
  const msg = __newString("Hello from AssemblyScript plugin!");
  log_info(msg);
}
