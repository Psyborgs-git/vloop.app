# Database Management

The orchestrator provides a unified database layer for both **internal** (provisioned SQLite) and **external** (Postgres/MySQL/SQLite) databases.

## Internal Databases

### Provisioning

```
Topic: db  |  Action: db.provision
Payload: { workspaceId: string, description?: string }
```

Creates a new AES-256 encrypted SQLite database. The encryption key is auto-generated and stored in the vault at `workspaces/{workspaceId}/databases/{dbId}/key`.

### Querying

```
Topic: db  |  Action: db.query
Payload: { workspaceId: string, dbId: string, sql: string, params?: any[] }
```

Executes raw SQL on an encrypted workspace database. Connections are pooled and cached by the `DatabasePool`.

### Disconnecting

```
Topic: db  |  Action: db.disconnect
Payload: { workspaceId: string, dbId: string }
```

Closes a cached connection.

## Root Database (Admin Only)

```
Topic: db  |  Action: db.root_query
Payload: { sql: string, params?: any[] }
```

Direct access to the orchestrator's root SQLite database. **Restricted to admin role** — enforced in the handler, not just RBAC policy. Useful for inspecting system tables like `users`, `sessions`, `vault_meta`, `external_databases`, etc.

## External Databases

External databases allow users to register connections to remote PostgreSQL, MySQL, or local SQLite databases. Credentials are stored securely in the vault.

### Register

```
Topic: db  |  Action: db.ext.register
Payload: {
    label: string,
    dbType: "postgres" | "mysql" | "sqlite",
    host?: string,
    port?: number,
    databaseName?: string,
    ssl?: boolean,
    username?: string,
    password?: string,
    filePath?: string     // SQLite only
}
```

The calling user's identity is automatically set as the owner. Credentials are encrypted and stored in the vault under `users/{owner}/ext-dbs/{id}/credentials`.

### List

```
Topic: db  |  Action: db.ext.list
```

Returns the calling user's registered external databases. Admins see all.

### Query

```
Topic: db  |  Action: db.ext.query
Payload: { id: string, sql: string, params?: any[] }
```

Executes SQL on an external database. Only the owner (or admin) may query.

### Test Connection

```
Topic: db  |  Action: db.ext.test
Payload: { id: string }
```

Tests connectivity by running `SELECT 1`.

### Remove

```
Topic: db  |  Action: db.ext.remove
Payload: { id: string }
```

Deletes the config and its vault credentials. Only the owner (or admin) may remove.

## Supported Drivers

| Type | Package | Install |
|------|---------|---------|
| PostgreSQL | `pg` | `pnpm add pg --filter @orch/db-manager` |
| MySQL | `mysql2` | `pnpm add mysql2 --filter @orch/db-manager` |
| SQLite | `better-sqlite3-multiple-ciphers` | Already installed |

Drivers are loaded dynamically at runtime. If a driver is not installed, the query returns a clear error message with install instructions.

## Architecture

```
┌──────────────────────────────────────────────┐
│               DB Handler                      │
│  (db.provision, db.query, db.disconnect,      │
│   db.root_query, db.ext.*)                    │
├──────────┬──────────┬──────────┬─────────────┤
│ Provisioner │  Pool   │ Root DB │ ExtRegistry │
│ (SQLite)    │ (cache) │ (admin) │ (pg/mysql)  │
├──────────┴──────────┴──────────┴─────────────┤
│                   Vault                       │
│         (encryption keys & credentials)       │
└──────────────────────────────────────────────┘
```
