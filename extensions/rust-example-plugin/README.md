# Rust Example Plugin

A complete Rust plugin example for the Orchestrator's `@extism/extism`-based plugin system. It demonstrates:

- **Logging** — `log_info` and `log_error` host functions.
- **Event subscription** — subscribing to `container.started` events.
- **Event publishing** — emitting a response event in the `plugin.rust-example-plugin.*` namespace.
- **`on_event` lifecycle hook** — responding to incoming subscribed events.

## Prerequisites

- Rust toolchain: https://rustup.rs
- WASI target: `rustup target add wasm32-wasip1`

## Building

```bash
cd extensions/rust-example-plugin
cargo build --target wasm32-wasip1 --release
cp target/wasm32-wasip1/release/rust_example_plugin.wasm .
```

## Packaging

```bash
zip rust-example-plugin.zip plugin.json rust_example_plugin.wasm
```

## Installing

```bash
# Stage and inspect the manifest
orch plugin install ./rust-example-plugin.zip

# Grant the requested permissions and activate
orch plugin grant rust-example-plugin \
  --permissions events:subscribe:container.started \
                events:publish

# Verify
orch plugin list
```

## Expected output

On startup:
```
{"level":"info","plugin":"rust-example-plugin","msg":"rust-example-plugin: on_start called"}
{"level":"info","plugin":"rust-example-plugin","msg":"rust-example-plugin: ready, subscribed to container.started"}
```

When a container starts:
```
{"level":"info","plugin":"rust-example-plugin","msg":"rust-example-plugin: received event 'container.started': {...}"}
```

## How it works

The plugin declares host functions imported from the `extism:host/user` namespace. At load time, `PluginSandbox` wires those imports to the orchestrator's `EventsHostFunctions` and `VaultHostFunctions`. No unsafe system calls leave the Wasm sandbox — every cross-boundary call goes through a controlled host function.

## Project layout

```
rust-example-plugin/
├── Cargo.toml         # Rust project manifest (cdylib crate type + extism-pdk)
├── plugin.json        # Orchestrator plugin manifest (id, version, permissions)
├── src/
│   └── lib.rs         # Plugin source code
└── README.md
```
