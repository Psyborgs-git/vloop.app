# AI Agent & Orchestrator Migration Notes (2026-03)

> Note: This document captures the earlier ai-agent consolidation phase.
> For the latest architecture state after the hard contract cutover, see
> [Typed App Lifecycle Migration (2026-03)](./typed-app-lifecycle-migration-2026-03.md).

This document records the architecture migration completed during this session.

## Scope

The migration consolidated AI orchestration ownership, removed duplicated runtime implementations, and hardened startup/runtime behavior.

## Summary of Changes

### 1) Single app entrypoint for `@orch/ai-agent`

- **Before**: package had both `src/app.ts` and `src/v2/app.ts` as effective app-config surfaces.
- **After**: `src/app.ts` is the single package app entrypoint containing DI registration and init.
- `src/v2/app.ts` was removed.
- `V2_REPOS` is now exported from `src/app.ts` and re-exported by public barrels.

### 2) MCP ownership moved to ai-agent package

- MCP server construction/handler remains implemented in `@orch/ai-agent` (`src/mcp-server.ts`).
- Orchestrator now initializes MCP from ai-agent exports.
- MCP tool execution remains session-scoped (session id, identity, roles included in tool context).

### 3) MCP served on dedicated port

- MCP HTTP server is now started as a dedicated Express server on `network.mcp_port`.
- WebSocket TLS server no longer multiplexes MCP routes.
- Health subsystem includes MCP status.
- Default config value introduced:
  - `network.mcp_port = 9446`

### 4) Canvas ownership moved to ai-agent package

- Canvas runtime, state manager, and server ownership are centralized in `@orch/ai-agent`.
- Orchestrator consumes ai-agent canvas exports and registers runtime topic handlers via ai-agent route helper.

### 5) Package-owned tool registration on init

- Tool registration flow supports package-level registration through routes module hook.
- Duplicate/central hardcoded registrations in orchestrator were removed.

### 6) Duplicate startup/runtime implementations removed from orchestrator

Redundant ai/canvas/mcp implementations were deleted from `packages/orchestrator/src/` and replaced with ai-agent exports.

### 7) Startup hardening fixes

Two startup regressions were fixed during migration:

- **DI registration fix**: corrected invalid tsyringe registration pattern for repos token (`V2_REPOS`) causing `TypeInfo not known for "undefined"`.
- **Idempotent tool registration**: guarded duplicate registrations in `registerTools()` to prevent `Tool already exists` boot failures.

## Data / Schema Notes

- v2 schema migration remains idempotent and executed on ai-agent app init (`V2_MIGRATION`).
- Session/message/state model remains DAG-native with branch/ancestry semantics.
- No destructive schema drop was introduced in this session.

## Operational Impact

- Existing websocket clients are unaffected for non-MCP operations.
- MCP clients should connect to the dedicated MCP port (`mcp_port`).
- Health checks remain:
  - `GET /healthz`
  - `GET /readyz`

## Verification Performed

- TypeScript builds passed for `@orch/ai-agent` and `@orch/orchestrator`.
- Targeted v2 tests passed (repos/handler/orchestrator/canvas-repo suites).
- Runtime smoke verified:
  - daemon ready
  - canvas server reachable
  - MCP endpoint reachable with auth middleware behavior

## Migration Checklist (Completed)

- [x] Unify ai-agent app entrypoint to root `src/app.ts`
- [x] Remove redundant `src/v2/app.ts`
- [x] Keep ai-agent as source of truth for MCP/canvas infra
- [x] Serve MCP on dedicated port
- [x] Harden startup against DI and duplicate tool registration failures
- [x] Update docs
