# PRD: Authentication & Session Management (FS-2)

| Field | Value |
|---|---|
| **Status** | Draft |
| **Date** | 2026-02-22 |
| **Feature Set** | FS-2: Auth & Session Management |
| **Dependencies** | FS-1 (Core Daemon), FS-9 (Secrets Vault) |

---

## 1. Problem Statement

Every WebSocket connection must be authenticated and every message authorized before reaching a feature handler. The system needs a flexible, policy-driven access control layer that supports both human operators and machine-to-machine (AI agent) authentication.

## 2. Goals

1. Authenticate connections via JWT bearer tokens or mTLS client certificates.
2. Issue short-lived session tokens with configurable TTL and refresh.
3. Enforce RBAC with resource-scoped permissions on every message.
4. Maintain an immutable audit trail of all mutations.
5. Support hot-reloading of RBAC policies without daemon restart.

## 3. Non-Goals

- OAuth2 authorization server (we consume tokens, not issue them).
- User management UI (managed externally).
- Multi-tenancy isolation (single-tenant daemon).

---

## 4. Authentication Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant WS as WebSocket Server
    participant AUTH as Auth Engine
    participant SESS as Session Manager

    C->>WS: WebSocket Upgrade + Authorization header (JWT)
    WS->>AUTH: Validate JWT (signature, expiry, claims)
    alt JWT Valid
        AUTH->>SESS: Create session (identity, roles, TTL)
        SESS-->>AUTH: Session{id, token, expires_at}
        AUTH-->>WS: AUTH_OK
        WS-->>C: Connected + session_token
    else JWT Invalid
        AUTH-->>WS: AUTH_FAILED (reason)
        WS-->>C: Close(4001, "authentication_failed")
    end

    Note over C,SESS: Subsequent messages include session_token in meta

    C->>WS: Request{meta: {session_id}}
    WS->>SESS: Validate session (not expired, not revoked)
    SESS-->>WS: Session context (identity, roles)
    WS->>WS: Continue to RBAC evaluation
```

### Supported Auth Methods

| Method | Mechanism | Use Case |
|---|---|---|
| **JWT Bearer** | `Authorization: Bearer <token>` in WebSocket upgrade headers | Human operators, CI/CD, API clients |
| **mTLS** | Client certificate presented during TLS handshake | Service-to-service, AI agents |

---

## 5. Functional Requirements

### FR-1: JWT Authentication

| ID | Requirement |
|---|---|
| FR-1.1 | Parse JWT from the `Authorization` header during WebSocket upgrade. |
| FR-1.2 | Verify signature using configured public keys (RS256, ES256, or EdDSA). Support JWKS endpoint or local PEM file. |
| FR-1.3 | Validate standard claims: `exp`, `nbf`, `iss`, `aud`. Configurable expected `iss` and `aud`. |
| FR-1.4 | Extract custom claims: `sub` (identity), `roles` (array of role names), `scope` (optional). |
| FR-1.5 | Reject expired, malformed, or unsigned tokens with specific error codes. |

### FR-2: mTLS Authentication

| ID | Requirement |
|---|---|
| FR-2.1 | Validate client certificate chain against configured CA certificates. |
| FR-2.2 | Extract identity from certificate CN or SAN fields. |
| FR-2.3 | Map certificate identity to roles via a configurable cert-to-role mapping. |

### FR-3: Session Management

| ID | Requirement |
|---|---|
| FR-3.1 | Create a session upon successful authentication. Generate a session token (opaque, 256-bit random). |
| FR-3.2 | Session stores: identity, roles, creation time, last activity, expiry, connection metadata. |
| FR-3.3 | Sessions expire after configurable idle timeout (default 1 hour) and max lifetime (default 24 hours). |
| FR-3.4 | Support session refresh: client sends `session.refresh` action to extend idle timeout. |
| FR-3.5 | Enforce max concurrent sessions per identity (configurable, default 10). |
| FR-3.6 | Revoke sessions explicitly via `session.revoke` action or automatically on connection close. |
| FR-3.7 | Persist active sessions in SQLite for crash recovery. Expire stale sessions on restart. |

### FR-4: RBAC Policy Engine

| ID | Requirement |
|---|---|
| FR-4.1 | Define roles in a TOML policy file. Each role has a list of permission grants. |
| FR-4.2 | Permission format: `<topic>:<action>:<resource_pattern>` (e.g., `container:create:*`, `vault:secret.get:db-*`). |
| FR-4.3 | Resource patterns support glob matching (`*` = any, `db-*` = prefix match). |
| FR-4.4 | Evaluate every inbound message against the session's roles. Deny by default. |
| FR-4.5 | Return `PERMISSION_DENIED` error with the required permission in the response. |
| FR-4.6 | Support policy hot-reload via `SIGHUP` or `admin.policy.reload` action. |

#### RBAC Policy Example

```toml
# /etc/orchestrator/policies.toml

[roles.admin]
description = "Full system access"
permissions = ["*:*:*"]

[roles.operator]
description = "Manage containers and processes"
permissions = [
    "container:*:*",
    "process:*:*",
    "vault:secret.get:*",
]

[roles.agent]
description = "AI agent - limited access"
permissions = [
    "container:create:agent-*",
    "container:stop:agent-*",
    "process:create:agent-*",
    "vault:secret.get:agent-*",
    "agent:*:self",
]

[roles.viewer]
description = "Read-only access"
permissions = [
    "container:list:*",
    "container:inspect:*",
    "process:list:*",
    "health:*:*",
]
```

### FR-5: Audit Logger

| ID | Requirement |
|---|---|
| FR-5.1 | Log every mutation (non-read) action with: timestamp, session_id, identity, topic, action, resource, outcome (allow/deny), trace_id. |
| FR-5.2 | Audit logs stored in a dedicated SQLite table (append-only). |
| FR-5.3 | Support audit log export via `admin.audit.query` action (admin role only). |
| FR-5.4 | Audit log entries are tamper-evident: each entry includes a hash chain linking to the previous entry. |

---

## 6. Data Model

```sql
-- Active sessions
CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,    -- Session ID (UUIDv7)
    token_hash  TEXT NOT NULL UNIQUE, -- SHA-256 of session token
    identity    TEXT NOT NULL,
    roles       TEXT NOT NULL,       -- JSON array of role names
    created_at  TEXT NOT NULL,
    last_active TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    conn_meta   TEXT,               -- JSON: remote_addr, user_agent, etc.
    revoked     INTEGER DEFAULT 0
);

-- Audit log
CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT NOT NULL,
    session_id  TEXT,
    identity    TEXT NOT NULL,
    topic       TEXT NOT NULL,
    action      TEXT NOT NULL,
    resource    TEXT,
    outcome     TEXT NOT NULL,       -- "allowed" | "denied"
    trace_id    TEXT,
    prev_hash   TEXT,               -- Hash chain
    entry_hash  TEXT NOT NULL        -- SHA-256(prev_hash + entry data)
);
```

---

## 7. WebSocket API

### Topic: `session`

| Action | Direction | Payload | Response |
|---|---|---|---|
| `session.info` | Client → Server | `{}` | `{session_id, identity, roles, expires_at}` |
| `session.refresh` | Client → Server | `{}` | `{session_id, new_expires_at}` |
| `session.revoke` | Client → Server | `{session_id?}` | `{ok: true}` |
| `session.list` | Client → Server | `{}` | `{sessions: [{id, identity, created_at, last_active}]}` (admin) |

### Topic: `admin`

| Action | Direction | Payload | Response |
|---|---|---|---|
| `policy.reload` | Client → Server | `{}` | `{ok: true, roles_loaded: N}` (admin) |
| `audit.query` | Client → Server | `{from?, to?, identity?, topic?, limit?}` | `{entries: [...]}` (admin) |

---

## 8. Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Valid JWT establishes a session; invalid JWT returns `4001` close code. |
| AC-2 | Session expires after idle timeout; subsequent messages return `SESSION_EXPIRED`. |
| AC-3 | `session.refresh` extends the session; `session.revoke` immediately invalidates it. |
| AC-4 | A `viewer` role can `container:list` but cannot `container:create` (denied with `PERMISSION_DENIED`). |
| AC-5 | Policy file changes are picked up on `SIGHUP` without restarting the daemon. |
| AC-6 | Audit log captures all mutations with correct identity, action, and outcome. |
| AC-7 | Audit log hash chain is verifiable (each entry hash links to previous). |
| AC-8 | mTLS client with a valid certificate is authenticated and assigned roles per cert mapping. |
