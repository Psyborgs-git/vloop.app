# Secure Wasm Plugin System

The Orchestrator includes a secure, sandboxed plugin system powered by WebAssembly (Wasm) and `@extism/extism`. Plugins can extend the system's capabilities while running in an isolated environment with granular permissions. Plugins can be written in **any language that compiles to WebAssembly** — Rust, Go, AssemblyScript, Python (via py2wasm), Zig, and more.

## Architecture

Plugins are distributed as `.zip` archives containing:
1. `plugin.json` — A manifest file describing the plugin and its requested permissions.
2. `plugin.wasm` — The compiled WebAssembly binary (WASI-compatible).
3. Additional assets (optional).

### Key Components

| Component | Package | Responsibility |
|-----------|---------|----------------|
| **PluginManager** | `@orch/plugin-manager` | Lifecycle: install, uninstall, load, unload |
| **PluginStore** | `@orch/plugin-manager` | Persists metadata & granted permissions in SQLite |
| **PluginSandbox** | `@orch/plugin-manager` | Runs each plugin in an isolated Extism instance |
| **PluginDownloader** | `@orch/plugin-manager` | Fetches `.zip` from URL or local path |
| **Host Functions** | `@orch/plugin-manager/host` | Controlled APIs exposed to the Wasm guest |

### Install Flow

```
User/CLI                     Orchestrator
   |                              |
   |-- plugin install <url> ----> |
   |                              |-- PluginDownloader.download()
   |                              |   (fetch + unzip to data/plugins/<id>/)
   |                              |
   |<-- PluginManifest + perms -- |
   |                              |
   |-- plugin grant <id> [perms]->|
   |                              |-- PluginManager.commitInstall()
   |                              |   (provision DB if needed)
   |                              |   (PluginStore.install())
   |                              |   (PluginSandbox created + on_start called)
   |<-- { success: true } ------- |
```

## Plugin Manifest (`plugin.json`)

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "Does cool stuff",
  "entrypoint": "plugin.wasm",
  "permissions": [
    "db:read",
    "db:write",
    "vault:read:my-secret",
    "events:subscribe:container.started",
    "events:publish"
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | ✅ | Lowercase alphanumeric + dashes. Must be unique. |
| `name` | ✅ | Human-readable display name. |
| `version` | ✅ | Semver string (`x.y.z`). |
| `description` | ✗ | Optional short description. |
| `author` | ✗ | Optional author string. |
| `entrypoint` | ✗ | Wasm file inside the zip (default: `plugin.wasm`). |
| `permissions` | ✗ | Array of requested permissions (default: `[]`). |

## Permissions

The system enforces a **default deny** policy. Plugins must explicitly request permissions in `plugin.json`, and an administrator must grant them at install time via `plugin grant`.

| Permission | Description |
|-----------|-------------|
| `db:read` | Read access to the plugin's isolated private SQLite database. |
| `db:write` | Write access to the plugin's isolated private SQLite database. |
| `vault:read:<key>` | Read a specific secret from the Vault by exact key name. |
| `vault:read:*` | Read any secret from the Vault. |
| `vault:write:<key>` | Write a specific secret to the Vault. |
| `vault:write:*` | Write any secret to the Vault. |
| `events:subscribe:<topic>` | Listen to a specific event topic on the system bus. |
| `events:subscribe:*` | Listen to all event topics. |
| `events:publish` | Publish events to the `plugin.<id>.*` namespace. |

> **Note**: Each plugin gets its own isolated SQLite database (provisioned by `@orch/db-manager`). Plugins cannot access the host's main database or other plugins' databases.

## Host Functions

Plugins import host functions using the namespace `extism:host/user`. These are the controlled APIs the host exposes to the Wasm guest.

### Logging

```
log_info(msg_offset: i64)
log_error(msg_offset: i64)
```

Write a string message to the orchestrator's structured logger (pino). Severity is `info` or `error`.

### Database

```
db_query(sql_offset: i64, _params_offset: i64) -> i64
```

Execute a SQL statement against the plugin's private, isolated SQLite database. Returns a JSON-encoded result array. Requires `db:read` (for SELECT) or `db:write` (for INSERT/UPDATE/DELETE).

> **Current limitation**: `db_query` requires JSPI (JavaScript Promise Integration) support to await the async host implementation. Until JSPI becomes stable in Node.js, plugins should use the `on_event` callback pattern for data exchange instead.

### Vault

```
vault_read(key_offset: i64) -> i64
vault_write(key_offset: i64, value_offset: i64) -> i64
```

Read or write a secret in the system Vault. Requires `vault:read:<key>` / `vault:write:<key>` (or wildcard) permission.

> **Current limitation**: `vault_read` and `vault_write` are async operations that require JSPI support. They return `{"error":"Async vault_read requires JSPI support"}` until JSPI is available.

### Events

```
events_subscribe(topic_offset: i64) -> i64
events_publish(topic_offset: i64, payload_offset: i64) -> i64
```

Subscribe to or publish on the system event bus (`HooksEventBus`). When a subscribed event fires, the host will call your plugin's exported `on_event(payload: i64) -> i64` function with a JSON payload `{"topic":"...","payload":...}`.

- `events_subscribe` requires `events:subscribe:<topic>` or `events:subscribe:*` permission.
- `events_publish` requires `events:publish` permission and restricts the topic to the `plugin.<id>.*` namespace.

## Exported Functions

Your Wasm module can export these well-known functions. The host calls them at the appropriate lifecycle point:

| Export | Called When | Input | Output |
|--------|------------|-------|--------|
| `on_start()` | Plugin is loaded | — | — |
| `on_event(payload)` | A subscribed event fires | JSON `{"topic":"…","payload":…}` | — |

Additional exports can be called programmatically via the internal `PluginSandbox.call(funcName, input)` API.

## CLI Usage

```bash
# Step 1: Download manifest and stage the plugin (does NOT activate it yet)
orch plugin install https://example.com/my-plugin.zip
orch plugin install ./my-plugin.zip

# Step 2: Review printed permissions, then grant and activate
orch plugin grant my-plugin --permissions db:read vault:read:my-key

# List installed plugins
orch plugin list

# Uninstall a plugin
orch plugin uninstall my-plugin
```

The two-step `install` → `grant` flow ensures administrators explicitly review and approve every permission before a plugin is activated.

## Security Model

- Each plugin runs inside its own Extism WebAssembly instance — full memory isolation.
- Host functions validate permissions on every call.
- Plugins cannot access the host filesystem, network, or other processes unless those capabilities are explicitly provided as host functions (currently none are).
- The `events:publish` permission is restricted to the `plugin.<id>.*` namespace so plugins cannot impersonate system events.
- Vault secret **values** are never logged by the host. Vault key identifiers may appear in permission-denied log messages for diagnostic purposes.

## Examples

See the `extensions/` directory for working plugin examples:

- [`extensions/hello-world-plugin/`](../../extensions/hello-world-plugin/) — AssemblyScript (TypeScript-like) plugin.
- [`extensions/rust-example-plugin/`](../../extensions/rust-example-plugin/) — Rust plugin demonstrating vault and events host functions.

For a step-by-step guide to building your first plugin, see [Getting Started: Plugin Development](../getting-started/plugin.md).
