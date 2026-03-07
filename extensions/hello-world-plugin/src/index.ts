// AssemblyScript entrypoint for a minimal "Hello World" plugin.
//
// Uses the official @extism/as-pdk to correctly allocate Extism memory
// blocks when passing strings to host functions. Raw AssemblyScript
// runtime strings (__newString) live in AS-managed heap memory and are
// NOT compatible with Extism's host-side callContext.read(offset).string()
// — only buffers allocated through the Extism PDK memory API are readable
// by the host.
//
// All host functions are imported from the `extism:host/user` namespace,
// which is the namespace registered by PluginSandbox in @orch/plugin-manager.

import { Memory } from "@extism/as-pdk";

// ── Host function imports ──────────────────────────────────────────────────

/** Log a message at INFO level via the orchestrator's structured logger. */
@external("extism:host/user", "log_info")
declare function log_info(ptr: i64): void;

/** Log a message at ERROR level via the orchestrator's structured logger. */
@external("extism:host/user", "log_error")
declare function log_error(ptr: i64): void;

// ── Exported lifecycle functions ──────────────────────────────────────────

/**
 * Called once by PluginManager immediately after the plugin is loaded.
 * Memory.fromString() allocates a UTF-8 Extism memory block; its .offset
 * is the value the host can read via callContext.read(offset).string().
 */
export function on_start(): void {
  const msg = Memory.fromString("Hello from AssemblyScript plugin!");
  log_info(msg.offset);
}
