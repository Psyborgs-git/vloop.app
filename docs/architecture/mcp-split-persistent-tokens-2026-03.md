# MCP Server Split + Persistent Token Model — March 2026

This document records the architectural changes made to split the MCP HTTP
server out of `@orch/ai-agent` into its own `@orch/mcp-server` component, and
the introduction of persistent API tokens for users and agents.

## Summary

| Change | Before | After |
|---|---|---|
| MCP HTTP ownership | `@orch/ai-agent` start/stop | `@orch/mcp-server` AppComponent |
| ai-agent scope | ToolRegistry + MCP + Canvas | ToolRegistry + Canvas only |
| Auth model | Short-lived session tokens only | Session tokens + persistent API tokens |
| Token storage | `sessions` table only | `sessions` + `persistent_tokens` tables |
| CLI commands | `orch auth login/user-*` | + `orch auth token-create/list/revoke` |

## New Package: `@orch/mcp-server`

- **Location**: `packages/mcp-server/`
- **AppComponent name**: `@orch/mcp-server`
- **Dependencies**: `["@orch/ai-agent", "@orch/auth"]`
- **Lifecycle**:
  - `register`: No-op (consumes shared DI tokens)
  - `init`: No-op
  - `start`: Resolves `TOKENS.ToolRegistry`, `TOKENS.SessionManager`,
    optional `TOKENS.TokenManager`, starts Express HTTP server on
    `config.network.mcp_port`
  - `stop`/`cleanup`: Graceful HTTP server close
- **Auth**: Bearer token validated through SessionManager (session tokens) or
  TokenManager (persistent `orch_` prefixed tokens)

## Persistent Token Model

### Schema (`persistent_tokens` table)

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | Unique token ID |
| `token_hash` | TEXT UNIQUE | SHA-256 hash of the raw token |
| `name` | TEXT | Human-readable label |
| `identity` | TEXT | Owner identity |
| `token_type` | TEXT | `user` or `agent` |
| `roles` | TEXT (JSON) | Assigned roles |
| `scopes` | TEXT (JSON) | Fine-grained scopes |
| `created_at` | TEXT | ISO timestamp |
| `expires_at` | TEXT | ISO timestamp or NULL (no expiry) |
| `last_used_at` | TEXT | Last usage timestamp |
| `revoked` | INTEGER | 0 = active, 1 = revoked |

### Token Format

Raw tokens are prefixed with `orch_` followed by 64 hex characters (32 random
bytes). The prefix enables the auth middleware to distinguish persistent tokens
from session tokens without a database lookup to determine token type.

### Operations

- **Create**: `auth` topic action `token.create` / CLI `orch auth token-create`
- **List**: `auth` topic action `token.list` / CLI `orch auth token-list`
- **Revoke**: `auth` topic action `token.revoke` / CLI `orch auth token-revoke`

### Auth Middleware Flow

1. Extract token from WS connection state or request meta
2. If token starts with `orch_` → validate via TokenManager
3. Otherwise → validate via SessionManager
4. Enrich context with identity, roles, sessionId
5. Proceed to RBAC evaluation

## Files Changed

### New Files
- `packages/mcp-server/package.json` — Package scaffold
- `packages/mcp-server/tsconfig.json` — TypeScript config
- `packages/mcp-server/src/app.ts` — AppComponent lifecycle
- `packages/mcp-server/src/mcp-server.ts` — MCP HTTP transport
- `packages/mcp-server/src/index.ts` — Public API surface
- `packages/auth/src/token-manager.ts` — Persistent token CRUD

### Modified Files
- `packages/shared/src/tokens.ts` — Added `TOKENS.TokenManager`
- `packages/shared/src/errors.ts` — Added token error codes
- `packages/ai-agent/src/app.ts` — Removed MCP server ownership
- `packages/auth/src/app.ts` — Registered TokenManager in DI
- `packages/auth/src/handler.ts` — Added token.create/list/revoke actions
- `packages/auth/src/middleware.ts` — Persistent token validation path
- `packages/auth/src/routes.ts` — Wired TokenManager to middleware + handler
- `packages/auth/src/index.ts` — Exported TokenManager types
- `packages/client/src/namespaces/auth.ts` — Token client methods
- `packages/cli/src/commands/auth.ts` — Token CLI commands
- `packages/daemon/src/config.ts` — Added @orch/mcp-server to installed apps
- `packages/orchestrator/package.json` — Added @orch/mcp-server dependency
- `packages/orchestrator/tsconfig.json` — Added mcp-server reference

## Rollout

1. Deploy auth package first (TokenManager schema is additive)
2. Deploy mcp-server package
3. Deploy updated ai-agent (MCP removed, no breaking change since tools still registered)
4. Update config to include `@orch/mcp-server` in installed apps (included in defaults)

### Troubleshooting

- If orchestrator startup fails with `ERR_MODULE_NOT_FOUND` for `@orch/mcp-server`
  while running package-scoped dev (`packages/orchestrator`), refresh that package's
  workspace links by reinstalling orchestrator dependencies in package scope.

## Related

- [Typed App Lifecycle Migration](typed-app-lifecycle-migration-2026-03.md)
- [AI Agent Migration](ai-agent-migration-2026-03.md)
