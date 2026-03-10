# Architecture

## Overview

`@orch/plugin-manager` loads, executes and manages WASM plugins at runtime.
Plugins are compiled to WebAssembly (via AssemblyScript or Rust) and execute
inside an [Extism](https://extism.org/) sandbox with tightly scoped host
functions.

```
┌─────────────────────────────────────────────────────────────────┐
│  @orch/daemon (DI container)                                    │
│                                                                 │
│   ┌──────────────┐   install / start / stop                    │
│   │ PluginManager│◄──────────────────────────────── CLI / HTTP │
│   └──────┬───────┘                                             │
│          │ loadPlugin()                                         │
│   ┌──────▼───────┐   Extism WASM sandbox                       │
│   │ PluginSandbox│                                             │
│   └──────┬───────┘                                             │
│          │ host functions                                       │
│   ┌──────┴──────────────────────────────────┐                  │
│   │  DbHostFunctions  │  VaultHostFunctions │                  │
│   │  EventsHostFns    │  TaskHostFunctions  │                  │
│   └─────────────────────────────────────────┘                  │
│          │                                                      │
│   ┌──────┴──────────┐ ┌──────────────┐ ┌──────────────────┐   │
│   │ DatabaseProvisioner│HooksEventBus│ │   VaultStore      │   │
│   └─────────────────┘ └─────────────┘ └──────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Component responsibilities

| Component | Responsibility |
|---|---|
| `PluginManager` | Owns the lifecycle (start / stop), coordinates install workflow, maintains the `sandboxes` map |
| `PluginSandbox` | Creates and holds the Extism plugin instance, routes WASM host-function calls to the appropriate host object |
| `PluginStore` | Drizzle-backed persistence of `PluginRecord` rows — install, list, enable/disable, delete |
| `PluginDownloader` | Fetches a ZIP (HTTP/local) or copies a directory, validates `plugin.json`, extracts to `<dataDir>/<id>/` |
| `DbHostFunctions` | Exposes a sandboxed SQLite database provisioned per-plugin via `@orch/db-manager` |
| `VaultHostFunctions` | Bridges `vault_read` / `vault_write` host calls to `@orch/vault` `VaultStore` |
| `EventsHostFunctions` | Bridges `events_subscribe` / `events_publish` host calls to `@orch/shared` `HooksEventBus` |
| `TaskHostFunctions` | Bridges structured domain operations (contacts, chat, AI, notifications) through the event bus |

## Install flow

```
CLI/HTTP ──► PluginManager.prepareInstall(url)
              │
              ├─ PluginDownloader.download(url)
              │    └─ extract/copy to <dataDir>/<id>/
              │
              └─ return PluginManifest (caller inspects required permissions)

CLI/HTTP ──► PluginManager.commitInstall(id, grantedPermissions)
              │
              ├─ read plugin.json from staging dir
              ├─ (optional) DatabaseProvisioner.provision() → dbId
              ├─ PluginStore.install(manifest, permissions, dbId)
              └─ loadPlugin() → new PluginSandbox(...)
```

## Plugin data directory layout

```
<dataDir>/              (default: ./data/plugins)
  <plugin-id>/
    plugin.json         manifest
    plugin.wasm         compiled WASM module (entrypoint)
    ...                 any additional assets declared in manifest
```

## Dependency injection

`app.ts` registers `PluginManager` as a lazy singleton in the tsyringe
container.  Optional services (`VaultStore`, `HooksEventBus`) are resolved with
a `try/catch` so the manager still starts when they are not registered.

The `start()` lifecycle hook:
1. Auto-installs any bundled extensions from the `./extensions/` directory that
   are not yet in the database.
2. Calls `PluginManager.start()` to load all enabled plugins.
