# Secure Wasm Plugin System

The Orchestrator includes a secure, sandboxed plugin system powered by WebAssembly (Wasm) and `@extism/extism`. Plugins can extend the system's capabilities while running in an isolated environment with granular permissions.

## Architecture

Plugins are distributed as `.zip` archives containing:
1. `plugin.json` - A manifest file describing the plugin and its requested permissions.
2. `plugin.wasm` - The compiled WebAssembly binary (WASI-compatible).
3. Additional assets (optional).

### Key Components

- **Plugin Manager**: Handles lifecycle (install, uninstall, load, unload).
- **Plugin Store**: Persists plugin metadata and granted permissions in the main SQLite database.
- **Sandboxing**: Each plugin runs in a separate Extism instance.
- **Host Functions**: The host exposes controlled APIs to the Wasm guest for logging, database access, vault access, and event bus communication.

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
    "events:subscribe:container.started"
  ]
}
```

## Permissions

The system enforces a "default deny" policy. Plugins must explicitly request permissions in `plugin.json`, and an administrator must grant them during installation.

- `db:read`, `db:write`: Access to the plugin's *isolated* private SQLite database.
- `vault:read:<key>`, `vault:write:<key>`: Access to specific keys in the system Vault.
- `events:subscribe:<topic>`: Ability to listen to system or other plugin events.
- `events:publish`: Ability to publish events to the `plugin.<id>.*` namespace.

## Host Functions

Plugins can import the following host functions (namespace: `extism:host/user`):

### Logging
- `log_info(offset)`: Log an info message.
- `log_error(offset)`: Log an error message.

### Database
- `db_query(sql_offset)`: Execute a SQL query against the private DB.

### Vault
- `vault_read(key_offset)`: Read a secret.
- `vault_write(key_offset, value_offset)`: Write a secret.

### Events
- `events_subscribe(topic_offset)`: Subscribe to a topic.
- `events_publish(topic_offset, payload_offset)`: Publish an event.

## CLI Usage

```bash
# Install a plugin from a URL
orch plugin install https://example.com/my-plugin.zip

# List installed plugins
orch plugin list

# Uninstall a plugin
orch plugin uninstall my-plugin
```
