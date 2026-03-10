# @orch/plugin-manager

Runtime lifecycle manager for WASM-based plugins in the vloop.app orchestrator.

## Table of contents

| Document | Description |
|---|---|
| [architecture.md](./architecture.md) | System design, data flow and component relationships |
| [api.md](./api.md) | Public TypeScript API — all exported classes, types and interfaces |
| [host-functions.md](./host-functions.md) | WASM host-function bridge reference |
| [permissions.md](./permissions.md) | Permission model and grant flow |
| [usage.md](./usage.md) | Integration guide and code examples |

## Quick-start

```ts
import { PluginManager } from '@orch/plugin-manager';

const manager = new PluginManager(db, orm, logger);
await manager.start();

// Install from a local ZIP or directory
const manifest = await manager.prepareInstall('/path/to/plugin.zip');
await manager.commitInstall(manifest.id, manifest.permissions);
```

## Package structure

```
src/
  app.ts            AppComponent registration (tsyringe DI container)
  manager.ts        PluginManager — lifecycle & install orchestration
  sandbox.ts        PluginSandbox — Extism WASM host with host-function wiring
  store.ts          PluginStore — Drizzle-backed persistent record store
  downloader.ts     PluginDownloader — ZIP / local-directory acquisition
  manifest.ts       PluginManifestSchema — Zod schema + PluginManifest type
  contracts.ts      Shared Zod schemas for task envelopes and host contracts
  schema.ts         Drizzle table definitions and SQL init helper
  handler.ts        Router topic handler (action dispatcher)
  routes.ts         AppRouterContract integration helper
  host/
    settings.ts     SettingsHostFunctions — K/V settings access
    vault.ts        VaultHostFunctions — secret store bridge
    events.ts       EventsHostFunctions — HooksEventBus pub/sub bridge
    task.ts         TaskHostFunctions — contacts / chat / AI / notifications
```
