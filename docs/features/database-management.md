# Database Management

vloop simplifies database operations for both developers and AI agents. It provides a unified interface to provision, manage, and query databases securely.

## Capabilities

*   **Provisioning**: Create new SQLite databases instantly.
*   **External Connections**: Register and manage connections to existing PostgreSQL and MySQL databases.
*   **Querying**: Execute SQL queries securely via the CLI or API.
*   **Access Control**: Restrict database access to specific agents or users.

## Internal Persistence Strategy

vloop service packages use **Drizzle ORM** for internal CRUD/query flows over SQLite.

Raw SQL is intentionally limited to:

*   **Schema bootstrap/migrations** (`CREATE TABLE`, `ALTER TABLE`, index creation)
*   **Dynamic query runner surfaces** where SQL is user-supplied by design (for DB tooling and plugin-hosted query execution)

When contributing, prefer Drizzle operations for application logic and treat new ad-hoc raw SQL as an exception that should be justified in code review.

## Internal Databases (SQLite)

For local development and lightweight apps, vloop can provision managed SQLite databases.

### CLI Usage

**Provision a database**:
```bash
orch db provision --workspace "project-alpha" --desc "Main app DB"
```

**Run a query**:
```bash
orch db query \
  --workspace "project-alpha" \
  --db "db-123" \
  --query "SELECT * FROM users WHERE active = 1"
```

## External Databases

Connect vloop to your production or staging databases (Postgres/MySQL) to give agents controlled access (e.g., "Run a report on last week's sales").

### Registration

Credentials are encrypted and stored in the Vault.

```bash
orch db ext register \
  --label "prod-replica" \
  --type "postgres" \
  --host "db.example.com" \
  --user "readonly_agent" \
  --password "vault:db/prod/password"
```

### Agent Access

Once registered, you can grant an agent permission to query this database via RBAC policies:

```toml
[roles.data_analyst_agent]
permissions = [
  "db:ext:query:prod-replica"
]
```

The agent can then use the `database_query` tool to pull data for analysis without ever seeing the raw credentials.
