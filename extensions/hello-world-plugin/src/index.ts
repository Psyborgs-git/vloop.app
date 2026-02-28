// AssemblyScript entrypoint for a simple plugin that logs "Hello World".

// Import host functions exposed by the orchestrator. The namespace must match
// what PluginSandbox registers (`extism:host/user`).
@external("extism:host/user", "log_info")
declare function log_info(offset: number): void;

// The runtime helper used by AssemblyScript to allocate a string in WASM memory.
// We declare it explicitly so that the compiler knows about it. Using `number`
// keeps TypeScript happy in the editor, asc will still treat it as a u32.
declare function __newString(str: string): number;

// Standard entrypoint called by the plugin manager on startup.
export function on_start(): void {
  const msg = "Hello from TypeScript plugin!";
  const ptr = __newString(msg);
  log_info(ptr);
}
