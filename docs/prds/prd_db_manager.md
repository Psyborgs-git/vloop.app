# PRD: Database Manager (FS-5)

## 1. Objective
Build the `@orch/db-manager` package. This module acts as the autonomous provisioning and connection pooling broker for local database stores. It will primarily govern SQLite instances, handling encryption-at-rest via SQLcipher wrappers, and federating database credentials for disparate AI workflows.

## 2. Requirements

### Functional
1. **Provisioning**: Programmatically create new, isolated SQLite database files for specific tenants or workflows.
2. **Encryption**: Integrate seamlessly with the `@orch/vault` to generate unique AES-256 keys (via `better-sqlite3-multiple-ciphers`) for each provisioned DB file.
3. **Connection Pooling**: Maintain active connection references, ensuring PRAGMA configurations (e.g., WAL mode, foreign keys, busy timeouts) are strictly enforced to prevent `SQLITE_BUSY` deadlocks.
4. **Lifecycle Management**: Safely close pools, backup databases to raw SQL dumps, and delete physical files when a workspace is destroyed.
5. **WebSocket Routing**: Expose `db.*` actions through the WebSocket router: `db.provision`, `db.query`, `db.exec`, `db.destroy`.

### Non-Functional
1. **Security**: Zero-knowledge policy. Raw encryption keys are never stored alongside the database file; they are kept ephemeral in memory or queried from the Vault.
2. **Performance**: SQLite instances must leverage WAL (Write-Ahead Logging) to maximize concurrent read throughput without blocking async tasks.
3. **Isolation**: A database allocated to Workspace A cannot be connected to without possessing Workspace A's unique Vault-derived identifier/key.

## 3. Interfaces
- `Provisioner`: Handles the file creation, schema bootstrapping, and key negotiation.
- `PoolManager`: Maintains the map of `Map<DbId, DatabaseClient>` tracking active handles and references.
- `Router Handler`: Integrates with the `Router` to validate RBAC policies before passing queries to the active handle.

## 4. Open Questions
- Should raw `db.query` execution be allowed over WebSocket, or should the orchestrator only provision the databases and hand the connection string/key to spawned processes?
  - *Decision:* We will support a generic `db.query` interface primarily for the AI Agent sandbox, though external processes should be given connection strings.
