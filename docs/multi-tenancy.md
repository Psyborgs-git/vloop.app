# Multi-Tenancy & Permissions

The orchestrator is a multi-tenant system. Every user authenticates via `auth.login` and receives a session with an **identity** (email) and one or more **roles**. Roles govern what actions are permitted, while **ownership** governs access to individual resources.

## Identity Flow

```
Client → WebSocket → Auth Middleware → HandlerContext
                                          ├── identity: string
                                          ├── roles: string[]
                                          └── sessionId: string
```

Every request (except `auth.login`) passes through [middleware.ts](../packages/auth/src/middleware.ts), which:

1. Validates the session token
2. Sets `context.identity`, `context.roles`, `context.sessionId`
3. Evaluates RBAC policy (`policies.toml`)
4. Logs mutations to the audit trail

## RBAC Policy

Policies live in [`config/policies.toml`](../config/policies.toml).

| Role | Scope |
|------|-------|
| `admin` | `*:*:*` — full access to everything |
| `operator` | Containers, processes, own vault secrets, own external DBs |
| `viewer` | Read-only: container/process listings, own vault secrets |
| `agent` | Scoped to `agent-*` resources + own DB queries |

### Policy Format

```
"topic:action:resource"
```

- `*` = wildcard
- `self` = the calling user's own resources (enforced at handler level)

## Vault — Owner Scoping

Every secret has an `owner` column:

| Owner Value | Meaning |
|-------------|---------|
| `__system__` | Internal secret (e.g., DB encryption keys) — admin-only |
| `user@email` | User-created secret — visible to owner + admins |

### Behavior

| Operation | Owner Logic |
|-----------|-------------|
| `secret.create` | Sets `owner = context.identity` |
| `secret.get` | Checks `owner === identity \|\| admin` |
| `secret.update` | Checks `owner === identity \|\| admin` |
| `secret.list` | Admins see all; users see own + `__system__` |
| `secret.delete` | No owner check (relies on RBAC) |

### Migration

Existing secrets default to `owner = '__system__'` via `ALTER TABLE`. The migration runs automatically on startup.

## External Databases — Owner Scoping

External DB configs in the `external_databases` table are strictly owner-scoped:

- `db.ext.register` → `owner` = calling user's identity
- `db.ext.list` → filtered to owner (admin sees all)
- `db.ext.query` / `db.ext.test` / `db.ext.remove` → checks `owner === identity || admin`

Credentials are stored in the vault at `users/{owner}/ext-dbs/{id}/credentials`.

## Root Database

The root orchestrator SQLite database is accessible only via `db.root_query`, which enforces `admin` role in the handler.
