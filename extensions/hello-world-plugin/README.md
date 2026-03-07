# Hello World Plugin (AssemblyScript)

A minimal example plugin written in [AssemblyScript](https://www.assemblyscript.org/) — a TypeScript-like language that compiles directly to WebAssembly. It logs a message when the orchestrator calls its `on_start` function.

This demonstrates:
- Importing host functions from the `extism:host/user` namespace.
- The `on_start` lifecycle hook.
- AssemblyScript memory management for string arguments.

## Building

```bash
cd extensions/hello-world-plugin
pnpm install
pnpm run build        # outputs build/plugin.wasm
```

## Packaging and installing

```bash
# Create the zip archive that the plugin manager expects
cd extensions/hello-world-plugin
zip hello-world.zip plugin.json build/plugin.wasm

# Stage the plugin (inspect manifest + permissions before activating)
orch plugin install ./hello-world.zip

# Grant permissions (none required here) and activate
orch plugin grant hello-world-plugin

# Confirm it is listed
orch plugin list
```

When the plugin loads you should see a log line similar to:

```
{"level":"info","plugin":"hello-world-plugin","msg":"Hello from AssemblyScript plugin!"}
```

## How it works

The plugin uses the [`@extism/as-pdk`](https://github.com/extism/as-pdk) to allocate strings in Extism-format memory blocks before passing them to host functions. Raw AssemblyScript runtime strings (`__newString`) are **not** compatible with Extism's host-side memory API and would produce garbled output.

The plugin imports two symbols from the `extism:host/user` namespace that the orchestrator exposes via `@extism/extism`:

| Import | Purpose |
|--------|---------|
| `log_info(ptr)` | Log an INFO-level message. `ptr` must be an Extism memory offset pointing to a UTF-8 string — use `Memory.fromString(str).offset` from `@extism/as-pdk`. |
| `log_error(ptr)` | Log an ERROR-level message. Same encoding requirements as `log_info`. |

`Memory.fromString(str)` from `@extism/as-pdk` allocates the string as a UTF-8 Extism memory block and returns a `Memory` object whose `.offset` is the value the host reads with `callContext.read(offset)?.string()`.

The exported `on_start()` function is called automatically by `PluginManager` when the plugin finishes loading.

## Project layout

```
hello-world-plugin/
├── asconfig.json      # AssemblyScript compiler config
├── package.json       # devDependency: assemblyscript
├── plugin.json        # Orchestrator plugin manifest
└── src/
    └── index.ts       # Plugin source (AssemblyScript)
```

## Next steps

- Add `vault:read:*` to `permissions` in `plugin.json` and call `vault_read` to fetch a secret.
- Subscribe to system events by calling `events_subscribe` with a topic string.
- See the [full plugin guide](../../docs/getting-started/plugin.md) for more.
