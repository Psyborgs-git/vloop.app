# Orchestrator System — Walkthrough

## M1: Workspace Scaffolding ✅

```
orchestrator/
├── package.json, pnpm-workspace.yaml, tsconfig.json, vitest.config.ts
├── config/ (config.toml, policies.toml)
├── tests/integration/ (health, auth, vault)
└── packages/
    ├── shared/     (4 files)   → errors, types, encrypted SQLite
    ├── daemon/     (7 files)   → config, protocol, router, server, health, logging, signal
    ├── auth/       (6 files)   → JWT, sessions, RBAC, audit, middleware
    ├── vault/      (5 files)   → crypto, store, handler, inject
    └── orchestrator/ (1 file)  → main.ts entrypoint
```

**Build**: `pnpm build` → `tsc --build` → 0 errors, all dist/ outputs generated

---

## M2: Unit Tests ✅ (88 tests)

| Package | Tests | Key Scenarios |
|---|---|---|
| `@orch/shared` | 19 | Error construction/serialization/wrapping, ID uniqueness, encrypted DB open/close/migrate/wrong-passphrase |
| `@orch/daemon` | 22 | TOML + env overrides + Zod validation, JSON/MessagePack round-trip, router dispatch + middleware chain + error boundary |
| `@orch/auth` | 26 | Session CRUD + max-limit + cleanup, RBAC scoping + glob + multi-role + reload, audit hash chain + filtering + pagination |
| `@orch/vault` | 21 | AES-256-GCM encrypt/decrypt, Argon2id KDF, DEK wrap/unwrap, zeroization, secret CRUD/versioning/pruning/list-without-values |

---

## M3-M4: Integration Tests ✅ (27 tests)

| Test Suite | Tests | What It Verifies |
|---|---|---|
| **Health endpoints** | 6 | `/healthz` subsystem reporting (healthy/degraded/unhealthy), `/readyz` gating before/after `markReady()` |
| **Auth pipeline** | 9 | Missing token → AUTH_REQUIRED, invalid token rejected, admin/viewer RBAC scoping, audit entries for mutations + denied access, context enrichment, session revocation |
| **Vault lifecycle** | 12 | Full CRUD (create→get→update→list→delete), handler dispatch (create/get/list/update/delete/unknown), `${vault:name}` injection in strings + env maps, passphrase verification on re-init |

---

## M5-M6: Workload Orchestration ✅ (Building & Typing)

We have successfully implemented the internal modules for container and process orchestration.

| Package | Capabilities | Code Structure |
|---|---|---|
| **`@orch/container`** | Connects to Docker cross-platform (ignoring failure states cleanly), maps API commands to pull images, stream logs, mount volumes, enforce limits, and track crashed containers. | 7 files mapping Docker lifecycle → WebSocket requests |
| **`@orch/process`** | Spawns generic LRPs tracking state across restarts, pinging health-check ports, streaming sub-process buffers in rings, and scheduling Cron definitions persisting state securely. | 6 files handling raw OS fork/exec, tree-killing, and timeouts |

**Current Status**: Both packages compile successfully (`tsc --build`) with 0 errors.

**Next Steps**: We have integrated these handlers into the main daemon executable (`main.ts`) and completed all unit & integration tests. Phase 3 is 100% complete!

---

## Final Result (Phases 1-3 Tests)

```
$ pnpm test
Test Files  19 passed (19)
     Tests  124 passed (124)
  Duration  1.16s
```

---

## Phase 4: Authentication & RBAC ✅

We have successfully overhauled the authentication and RBAC system to support both human operators and machine-to-machine (AI agent) authentication.

| Package | Capabilities | Code Structure |
|---|---|---|
| **`@orch/auth`** | Local user management (bcryptjs), dynamic JWT provider whitelisting (jose JWKS), stateful WebSocket authentication (`ws.sessionId`), internal RBAC enforcement for AI agents via `router.dispatch`. | Updated `session.ts`, `rbac.ts`, `middleware.ts`, `jwt.ts` |
| **`@orch/client`** | Client SDK updated to support explicit `client.auth.login()` flow instead of passing tokens in the connection URL. | Updated `client.ts`, `namespaces/auth.ts` |
| **`@orch/web-ui`** | React UI (`AuthView.tsx`) for access control management (local users, JWT providers). | Added `AuthView.tsx`, updated `App.tsx` |
| **`@orch/orchestrator`** | Dynamic key generation and `./data/keys/` storage mechanism for DB and Vault passphrases. | Updated `main.ts` |

**Current Status**: All packages compile successfully (`tsc --build`) with 0 errors. All integration tests pass.

---

## Phase 5: Multi-Tenant System Upgrade ✅

Transformed the orchestrator into a fully multi-tenant system with per-user data isolation.

| Area | Changes |
|------|---------|
| **Live Dashboard** | `DashboardView.tsx` — replaced mock data with real-time RPC calls (`process.list`, `container.list`, `health.check`, `session.info`), auto-refresh, session banner |
| **Root DB Access** | `db-manager/handler.ts` — admin-only `db.root_query` action, `main.ts` wired root `DatabaseManager` |
| **External DB Registry** | `db-manager/external-db.ts` *(new)* — Postgres/MySQL/SQLite, owner-scoped ACL, vault-stored credentials |
| **Per-User Vault** | `vault/store.ts` — `owner` column + migration, `handler.ts` passes identity context |
| **RBAC Policies** | `policies.toml` — `self` scoping for vault + ext DB, admin-only root DB |
| **Web UI** | `DataView.tsx` — 3 connection modes (Workspace/Root/External), register dialog; `serviceRegistry.ts` — 6 new actions |

**Documentation**: See [`docs/multi-tenancy.md`](multi-tenancy.md), [`docs/database.md`](database.md), and [`docs/terminal.md`](terminal.md).

**Current Status**: All packages compile with 0 errors.
