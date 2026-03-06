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

The plugin imports two symbols from the `extism:host/user` namespace that the orchestrator exposes via `@extism/extism`:

| Import | Purpose |
|--------|---------|
| `log_info(ptr)` | Log a UTF-16 string at `ptr` at INFO level |
| `__newString(str)` | AssemblyScript runtime helper — allocates `str` and returns its address |

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
