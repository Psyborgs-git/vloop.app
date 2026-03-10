# Usage Guide

## 1. DI container integration (recommended)

`@orch/plugin-manager` ships an `AppComponent` in `app.ts` that wires itself
into the tsyringe container used by `@orch/daemon`.

```ts
// packages/daemon/src/bootstrap.ts (or equivalent)
import pluginManagerComponent from '@orch/plugin-manager/app';

// Register the component with the orchestrator
orchestrator.use(pluginManagerComponent);
```

The component:
- Registers `PluginManager` as a resolvable singleton.
- Auto-installs bundled extensions from `./extensions/` on `start()`.
- Resolves `VaultStore` and `HooksEventBus` lazily (optional; disabled if not
  registered).

---

## 2. Manual instantiation

Use this when writing tests or integrating outside the daemon DI system.

```ts
import Database from 'better-sqlite3-multiple-ciphers';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { PluginManager } from '@orch/plugin-manager';
import { DatabaseProvisioner } from '@orch/db-manager';

const db = new Database('./data/app.db');
const orm = drizzle(db);
const dbProvisioner = new DatabaseProvisioner(/* … */);
const logger = pino();

const manager = new PluginManager(db, orm, dbProvisioner, logger, './data/plugins');
await manager.start();
```

---

## 3. Installing a plugin

### From a remote ZIP

```ts
const manifest = await manager.prepareInstall('https://example.com/my-plugin.zip');
console.log('Requires permissions:', manifest.permissions);

// Grant all declared permissions (admin decision)
await manager.commitInstall(manifest.id, manifest.permissions);
```

### From a local directory

```ts
const manifest = await manager.prepareInstall('/workspace/my-plugin');
await manager.commitInstall(manifest.id, ['chat:read', 'chat:write']);
```

### Cancelling a staged installation

If you decide not to grant permissions after `prepareInstall`, clean up the
staged files:

```ts
manager.cancelInstall(manifest.id);
```

---

## 4. Router handler integration

```ts
import { registerRoutes } from '@orch/plugin-manager/routes';

// Inside your daemon startup, after DI is wired:
registerRoutes(container, router);
```

This registers the `plugin` topic with the following actions:

```ts
// Install (admin only)
router.dispatch({ topic: 'plugin', action: 'install', payload: { url: '...' } });

// Grant permissions (admin only)
router.dispatch({ topic: 'plugin', action: 'grant', payload: { id: 'my-plugin', permissions: ['chat:read'] } });

// Cancel staged install (admin only)
router.dispatch({ topic: 'plugin', action: 'cancel', payload: { id: 'my-plugin' } });

// List all plugins (any role)
router.dispatch({ topic: 'plugin', action: 'list', payload: {} });

// Uninstall (admin only)
router.dispatch({ topic: 'plugin', action: 'uninstall', payload: { id: 'my-plugin' } });
```

---

## 5. Calling a plugin function directly

`PluginSandbox` is normally managed entirely by `PluginManager`.  If you need
to invoke a plugin export directly (e.g. in an integration test):

```ts
const sandbox = new PluginSandbox(manifest, pluginDir, permissions, logger);

// Call a named WASM export
const result = await sandbox.call('on_message', JSON.stringify({ text: 'hello' }));
console.log(result); // JSON string returned by the plugin

await sandbox.close();
```

---

## 6. Writing a plugin (`plugin.json`)

Every plugin must include a `plugin.json` manifest at its root:

```json
{
  "id": "my-chat-bot",
  "name": "My Chat Bot",
  "version": "1.0.0",
  "description": "A simple chat relay plugin",
  "author": "me@example.com",
  "entrypoint": "plugin.wasm",
  "task": "chat",
  "host_features": {
    "logging": true,
    "chat": true,
    "notifications": true
  },
  "permissions": [
    "chat:read",
    "chat:write",
    "notifications:publish"
  ]
}
```

The `id` must match `^[a-z0-9-]+$` and `version` must be semver.

---

## 7. Handling events in a plugin (AssemblyScript)

```ts
// assembly/index.ts
import { input_string, store_string } from '@extism/as-pdk';

// Called by the host for every event the plugin subscribed to
export function on_event(): i32 {
  const raw = input_string();
  // raw = '{"topic":"plugin.my-chat-bot.custom","payload":"{…}"}'
  const envelope = JSON.parse(raw);
  // … process event
  store_string('{}');
  return 0;
}

// Called once when the plugin is loaded
export function on_start(): i32 {
  // Optionally subscribe to topics via host call
  return 0;
}
```

---

## 8. Auto-install bundled extensions

Place extension directories inside `./extensions/` at the repo root.  Each
must contain a valid `plugin.json`.  On daemon start the `autoInstallFromDir`
method scans the directory and installs any extension not already in the DB,
granting all permissions that the extension declares.

```
extensions/
  telegram-chat-plugin/
    plugin.json
    plugin.wasm
  hello-world-plugin/
    plugin.json
    plugin.wasm
```

---

## 9. Listing and uninstalling

```ts
// List all installed plugins
const records = manager.list();
// records: PluginRecord[]

// Uninstall by ID
await manager.uninstall('my-chat-bot');
```
