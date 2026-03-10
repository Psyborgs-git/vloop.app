# Public API Reference

All symbols exported from `@orch/plugin-manager` (the package root `index.ts`).

---

## `PluginManager`

`src/manager.ts` — primary class; register via tsyringe or instantiate directly.

### Constructor

```ts
new PluginManager(
  db: BetterSqlite3.Database,
  orm: RootDatabaseOrm,
  logger: Logger,
  dataDir?: string,          // default: './data/plugins'
  vaultStore?: VaultStore,
  eventBus?: HooksEventBus
)
```

### Methods

| Method | Signature | Description |
|---|---|---|
| `start` | `() => Promise<void>` | Load all enabled plugins from the DB; called once at daemon start |
| `stop` | `() => Promise<void>` | Close every running sandbox; idempotent |
| `prepareInstall` | `(urlOrPath: string) => Promise<PluginManifest>` | Download/copy plugin files to staging; returns parsed manifest for permission review |
| `commitInstall` | `(id: string, grantedPermissions: string[]) => Promise<void>` | Persist the record, create the data folder, then load the plugin |
| `cancelInstall` | `(id: string) => void` | Remove staged files without inserting a DB record |
| `list` | `() => PluginRecord[]` | Return all installed plugin records |
| `uninstall` | `(id: string) => Promise<void>` | Stop sandbox, delete files, remove DB record |
| `autoInstallFromDir` | `(dir: string) => Promise<void>` | Scan a directory and install any plugins not yet in the DB |

---

## `PluginStore`

`src/store.ts` — low-level Drizzle-backed persistence layer.

### Constructor

```ts
new PluginStore(
  db: { exec(sql: string): unknown },  // better-sqlite3 Database
  orm: RootDatabaseOrm
)
```

### Methods

| Method | Signature | Description |
|---|---|---|
| `install` | `(manifest: PluginManifest, permissions: string[], ) => void` | Upsert a plugin record |
| `uninstall` | `(id: string) => void` | Delete by primary key |
| `get` | `(id: string) => PluginRecord \| undefined` | Fetch a single record |
| `list` | `() => PluginRecord[]` | Fetch all records |
| `setEnabled` | `(id: string, enabled: boolean) => void` | Toggle enabled flag without re-installing |

### `PluginRecord` interface

```ts
interface PluginRecord {
  id: string;
  enabled: boolean;
  manifest: PluginManifest;
  granted_permissions: string[];
  installed_at: string;   // ISO 8601
  }
```

---

## `PluginSandbox`

`src/sandbox.ts` — wraps a single Extism WASM plugin instance.

### Constructor

```ts
new PluginSandbox(
  manifest: PluginManifest,
  pluginDir: string,
  permissions: string[],
  logger: Logger,
  settingsHost?: SettingsHostFunctions,
  vaultHost?: VaultHostFunctions,
  eventsHost?: EventsHostFunctions,
  taskHost?: TaskHostFunctions
)
```

### Methods

| Method | Signature | Description |
|---|---|---|
| `call` | `(funcName: string, input?: string \| Uint8Array) => Promise<string>` | Invoke a named WASM export; returns UTF-8 text output |
| `close` | `() => Promise<void>` | Cleanup event subscriptions and close the Extism plugin |

### `HostFunctionContext` interface

```ts
interface HostFunctionContext {
  logger: Logger;
  pluginId: string;
  permissions: string[];
}
```

---

## `PluginDownloader`

`src/downloader.ts` — acquires plugin artifacts from remote or local sources.

### Constructor

```ts
new PluginDownloader(pluginsDir: string, logger: Logger)
```

Creates `pluginsDir` if it does not exist.

### Methods

| Method | Signature | Description |
|---|---|---|
| `download` | `(urlOrPath: string) => Promise<{ manifest: PluginManifest; dir: string }>` | Download/copy and validate a plugin; supports HTTP(S), local file paths, `file://` URLs, directories and bare `plugin.json` paths |

---

## `createPluginHandler`

`src/handler.ts` — creates the `AppTopicHandler` for the `plugin` router topic.

```ts
function createPluginHandler(pluginManager: PluginManager): AppTopicHandler
```

Supported actions and their validated payload shapes:

| Action | Payload schema | Role required |
|---|---|---|
| `install` | `{ url: string }` | `admin` |
| `grant` | `{ id: string; permissions: string[] }` | `admin` |
| `cancel` | `{ id: string }` | `admin` |
| `list` | _(none)_ | — |
| `uninstall` | `{ id: string }` | `admin` |

Payloads are validated with Zod; invalid shapes throw `OrchestratorError(VALIDATION_ERROR)`.
Unauthorized requests throw `OrchestratorError(PERMISSION_DENIED)`.

---

## Manifest types

### `PluginManifest`

Parsed from `plugin.json` at the root of every plugin archive/directory.

```ts
interface PluginManifest {
  id: string;              // lowercase alphanumeric + dashes, e.g. "telegram-chat"
  name: string;
  version: string;         // semver "x.y.z"
  description?: string;
  author?: string;
  entrypoint: string;      // default "plugin.wasm"
  task?: PluginTask;       // "chat" | undefined
  host_features?: PluginHostFeatureFlags;
  permissions: string[];   // declared required permissions
}
```

### `PluginPermission`

```ts
type PluginPermission =
  | 'settings:read' | 'settings:write' | 'fs:read' | 'fs:write'
  | 'vault:read' | 'vault:write'
  | 'contacts:read' | 'contacts:write'
  | 'chat:read' | 'chat:write'
  | 'agent:run'
  | 'notifications:publish'
  | 'events:subscribe'
  | 'events:publish'
  | 'network:outbound';
```

### `PluginHostFeatureFlags`

Controls which host-function bridges are exposed to the plugin:

```ts
interface PluginHostFeatureFlags {
  logging?: boolean;
  vault?: boolean;
  contacts?: boolean;
  chat?: boolean;
  ai_inference?: boolean;
  notifications?: boolean;
}
```

---

## Contract types (`src/contracts.ts`)

### `PluginTaskHostContract`

Returned by `TaskHostFunctions.getContract()` and serialised to the plugin via
the `host_get_contract` host function.

```ts
interface PluginTaskHostContract {
  version: 1;
  task: PluginTask;
  pluginId: string;
  permissions: string[];
  features: {
    logging: { info: 'log_info'; error: 'log_error' };
    vault?: { read: 'vault_read'; write: 'vault_write'; requiresJspi: boolean };
    contacts?: { request: 'contacts_manage'; scope: 'plugin'; transport: 'hooks-event-bus' };
    chat?: { request: 'chat_manage'; scope: 'plugin'; transport: 'hooks-event-bus' };
    ai_inference?: { infer: 'agent_infer'; transport: 'hooks-event-bus' };
    notifications?: { notify: 'notifications_notify'; topicPrefix: string };
  };
}
```

### `PluginTaskEnvelope`

Payload published on the `HooksEventBus` when a plugin executes a domain
operation:

```ts
interface PluginTaskEnvelope {
  pluginId: string;
  task: PluginTask;
  domain: 'contacts' | 'chat' | 'ai_inference' | 'notifications';
  operation: string;
  request: unknown;
  requestedAt: string;  // ISO 8601
}
```

### `QueuedPluginTaskResponse`

Returned to the plugin synchronously after the event is published:

```ts
interface QueuedPluginTaskResponse {
  ok: true;
  queued: true;
  topic: string;
}
```

---

## DB types (`src/host/db.ts`)

```ts
/** Allowed SQLite bind parameter types. */
type SqlParam = string | number | bigint | boolean | null | Uint8Array;

/** A single row returned by a plugin DB query. */
type SqlRow = Record<string, string | number | bigint | boolean | null | Uint8Array>;
```
