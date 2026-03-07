# Guide: Creating a Wasm Plugin

This guide walks you through creating plugins for the Orchestrator using two popular approaches: **Rust** (recommended for performance) and **AssemblyScript** (TypeScript-like, easier setup).

Plugins are compiled to WebAssembly and loaded by the `@extism/extism`-based `PluginManager`. Any WASI-compatible Wasm language is supported.

---

## Option A: Rust Plugin (Recommended)

### Prerequisites

- Rust and `cargo` installed: https://rustup.rs
- `wasm32-wasip1` target: `rustup target add wasm32-wasip1`

### Step 1: Create project

```bash
cargo new --lib my-plugin
cd my-plugin
```

### Step 2: Edit `Cargo.toml`

```toml
[lib]
crate-type = ["cdylib"]

[dependencies]
extism-pdk = "1.4"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

### Step 3: Write `src/lib.rs`

```rust
use extism_pdk::*;

// Declare host functions exposed by the orchestrator.
// These map to the `extism:host/user` namespace.
#[link(wasm_import_module = "extism:host/user")]
extern "C" {
    fn log_info(ptr: u64);
    fn log_error(ptr: u64);
    fn events_subscribe(topic_ptr: u64) -> u64;
    fn events_publish(topic_ptr: u64, payload_ptr: u64) -> u64;
}

/// Called once when the plugin is loaded.
#[plugin_fn]
pub fn on_start(_: ()) -> FnResult<()> {
    // Use the extism PDK for memory management
    let msg = "my-plugin started!";
    unsafe {
        let ptr = extism_pdk::Memory::from_bytes(msg.as_bytes()).offset();
        log_info(ptr);
    }
    Ok(())
}

/// Called whenever a subscribed event fires.
/// Input: JSON string `{"topic":"…","payload":…}`
#[plugin_fn]
pub fn on_event(input: String) -> FnResult<()> {
    let msg = format!("Received event: {}", input);
    unsafe {
        let ptr = extism_pdk::Memory::from_bytes(msg.as_bytes()).offset();
        log_info(ptr);
    }
    Ok(())
}
```

> **Tip**: See [`extensions/rust-example-plugin/`](../../extensions/rust-example-plugin/) for a complete, working example with event subscription.

### Step 4: Create `plugin.json`

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "description": "My first Orchestrator plugin",
  "entrypoint": "my_plugin.wasm",
  "permissions": []
}
```

### Step 5: Build and package

```bash
# Build targeting WASI
cargo build --target wasm32-wasip1 --release

# Copy the output next to plugin.json
cp target/wasm32-wasip1/release/my_plugin.wasm .

# Package as a zip archive
zip my-plugin.zip plugin.json my_plugin.wasm
```

### Step 6: Install

```bash
# Stage the plugin (prints manifest + requested permissions)
orch plugin install ./my-plugin.zip

# Grant permissions and activate
orch plugin grant my-plugin

# Verify it appears in the list
orch plugin list
```

---

## Option B: AssemblyScript Plugin

AssemblyScript is a TypeScript-like language that compiles to Wasm. It's a great choice if you already know JavaScript/TypeScript.

See the complete working example at [`extensions/hello-world-plugin/`](../../extensions/hello-world-plugin/).

### Prerequisites

- Node.js ≥ 18 and `pnpm` (or `npm`)

### Step 1: Create project

```bash
mkdir my-as-plugin && cd my-as-plugin
pnpm init
pnpm add -D assemblyscript @extism/as-pdk
npx asinit .
```

> **Important**: Always use [`@extism/as-pdk`](https://github.com/extism/as-pdk) to allocate strings and pass them to host functions. Raw AssemblyScript runtime strings (`__newString`) use AS-managed heap memory which is **not** compatible with Extism's host-side `callContext.read(offset)` API. Use `Memory.fromString(str).offset` instead.

### Step 2: Write `assembly/index.ts`

```typescript
import { Memory } from "@extism/as-pdk";

// Import host functions from the orchestrator.
// The namespace MUST be "extism:host/user".
// Pointer args (i64) must be Extism memory offsets — use Memory.fromString().offset.
@external("extism:host/user", "log_info")
declare function log_info(ptr: i64): void;

@external("extism:host/user", "events_subscribe")
declare function events_subscribe(topicPtr: i64): i64;

/** Called once when the plugin is loaded. */
export function on_start(): void {
  const msg = Memory.fromString("my-as-plugin started!");
  log_info(msg.offset);

  // Subscribe to a system event — requires events:subscribe:container.started permission
  const topic = Memory.fromString("container.started");
  events_subscribe(topic.offset);
}

/** Called whenever a subscribed event fires.
 *  The host invokes this via plugin.call("on_event", payload) where payload
 *  is a UTF-8 JSON string: {"topic":"...","payload":...}.
 *  Use the extism input() helper to read it from the Extism input buffer.
 */
export function on_event(): void {
  const payload = String.UTF8.decode(input());
  const msg = Memory.fromString(`Received event: ${payload}`);
  log_info(msg.offset);
}
```

### Step 3: Configure `asconfig.json`

```json
{
  "targets": {
    "release": {
      "outFile": "build/plugin.wasm",
      "optimize": true
    }
  },
  "entries": ["assembly/index.ts"]
}
```

### Step 4: Create `plugin.json`

```json
{
  "id": "my-as-plugin",
  "name": "My AssemblyScript Plugin",
  "version": "0.1.0",
  "entrypoint": "build/plugin.wasm",
  "permissions": ["events:subscribe:container.started"]
}
```

### Step 5: Build and package

```bash
pnpm run asbuild:release

# Package — run from inside the plugin directory
zip my-as-plugin.zip plugin.json build/plugin.wasm
```

### Step 6: Install

```bash
orch plugin install ./my-as-plugin.zip
orch plugin grant my-as-plugin --permissions events:subscribe:container.started
```

---

## Permissions Reference

When requesting permissions, add them to both `plugin.json` (as a declaration) and supply them at `orch plugin grant` time (as an explicit approval).

| Permission | What it enables |
|-----------|----------------|
| `db:read` | Read from the plugin's private SQLite DB |
| `db:write` | Write to the plugin's private SQLite DB |
| `vault:read:<key>` | Read a specific Vault secret |
| `vault:write:<key>` | Write a specific Vault secret |
| `events:subscribe:<topic>` | Receive events on a topic |
| `events:publish` | Emit events in the `plugin.<id>.*` namespace |

See [Plugin System Architecture](../features/plugins.md) for full details.
