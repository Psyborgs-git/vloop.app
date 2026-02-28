# Hello World Plugin (TypeScript)

This is a minimal test plugin written in AssemblyScript (a TypeScript-like language) that compiles to WebAssembly. It logs a message when the orchestrator calls its `on_start` function.

## Building

```bash
cd extensions/hello-world-plugin
pnpm install  # or npm install
pnpm run build
```

The resulting `build/plugin.wasm` file is referenced by the `plugin.json` manifest.

## Installing for testing

1. Zip the manifest and the Wasm file:
   ```bash
   cd extensions/hello-world-plugin
   zip ../hello-world.zip plugin.json build/plugin.wasm
   ```
2. Use the orchestrator CLI:
   ```bash
   orch plugin install ../hello-world.zip
   orch plugin list
   ```
3. When the plugin loads, you should see a log entry containing the hello message.

> This example lives under `extensions/` purely for convenience; the plugin system ultimately loads whatever
> archive you provide at runtime. The `extensions/` folder is not special in the codebase but keeps local
> test helpers together.
