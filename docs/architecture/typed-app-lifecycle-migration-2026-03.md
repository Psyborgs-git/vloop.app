# Typed App Lifecycle Migration (2026-03)

This document records the hard-cutover migration from legacy app config objects to strict typed lifecycle components.

## Goals

- Make every package app a reusable, self-managed component.
- Keep orchestrator as a secure gateway (context injection + auth/policy boundaries).
- Decouple package runtime ownership (MCP/canvas/services owned by their package, not orchestrator internals).
- Add secured runtime lifecycle controls (status/restart) without weakening RBAC.

## New Contract

All installable app packages now export a default `AppComponent` from `src/app.ts`:

- `register(container)`
- `init(ctx)`
- `start(ctx)`
- `stop(ctx)`
- `cleanup(ctx)`
- optional `healthCheck(ctx)`

Core types are defined in `@orch/shared`:

- `AppComponent`
- `AppComponentContext`
- `ComponentState` / `ComponentStatus`
- router/tool/health contracts (`AppRouterContract`, `AppToolRegistryContract`, `AppHealthServerContract`)

Additional shared tokens were introduced for cross-package DI:

- `TOKENS.ToolRegistry`
- `TOKENS.SessionManager`

## Orchestrator Changes

### Lifecycle orchestration

`@orch/orchestrator` now uses `ComponentLifecycleManager` to:

1. load components
2. register all in dependency order
3. init all in dependency order
4. discover routes/health/tools
5. start all in dependency order
6. stop + cleanup in reverse dependency order

### Gateway responsibilities (retained)

Orchestrator remains the boundary for:

- auth/session middleware and policy enforcement
- health server and websocket server
- encrypted DB bootstrap and shared container wiring
- process signals/reload hooks and PID lifecycle

### Runtime hardening

- App modules are now validated at load time for full `AppComponent` shape (not just `name`).
- Startup fails fast with actionable errors for invalid package exports.
- `predev` now builds all `@orch/*` workspace packages to prevent stale `dist` contracts.

## Package Migration Matrix

### Fully migrated to `AppComponent`

- `@orch/ai-agent` (owns MCP + canvas runtime lifecycle)
- `@orch/auth`
- `@orch/vault`
- `@orch/db-manager`
- `@orch/process`
- `@orch/container`
- `@orch/terminal`
- `@orch/media`
- `@orch/plugin-manager`

## Lifecycle Control Plane

A secured router topic is exposed by orchestrator:

- topic: `lifecycle`
- actions:
  - `status` → component states
  - `restart` → stop/start one named component

Authorization:

- requires `admin` role
- non-admin attempts fail with authorization error

## Cleanup Completed During Migration

- Removed legacy orchestrator lifecycle paths (`loadedApps`, app-ordering logic in app.ts, old server bootstrap coupling).
- Removed direct orchestrator ownership of ai-agent MCP/canvas runtime internals.
- Replaced daemon-specific handler/router types in migrated packages with shared app contracts where applicable.
- Fixed duplicate `media/routes.ts` declarations and legacy `AppConfig` leftovers.

## Verification

The following were validated after migration:

- Type-checks for all migrated packages.
- Orchestrator startup through package `dev` path with all configured apps loaded.
- Runtime logs show successful registration + startup of all installed components and readiness (`🚀 Orchestrator daemon is ready`).

## Backward Compatibility

This migration is a **breaking change** by design:

- legacy `AppConfig` app modules are no longer accepted.
- all installed app packages must implement the full typed `AppComponent` contract.
