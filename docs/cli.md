# Orchestrator CLI Documentation

The Orchestrator CLI (`orch`) is a command-line tool for interacting with the Orchestrator Daemon. It allows you to manage processes, containers, secrets, databases, AI agents, and authentication.

## Logging and output

The orchestrator and its sub‑packages use [pino](https://getpino.io) for
structured JSON logging. By default the daemon emits a single JSON object per
line for easy machine parsing and journal ingestion. If you prefer a human‑
readable stream in your terminal, set one of the following before running any
command that starts the daemon (or in the environment where the CLI invokes it):

```bash
# automatically enabled in non-production builds
NODE_ENV=development

# or force pretty mode explicitly
PINO_PRETTY=1
```

Both will invoke `pino-pretty` internally and print coloured, multi‑line output
with timestamps. Production containers keep the raw JSON for log shippers.

## Installation

Ensure you have built the CLI package:

```bash
cd packages/cli
pnpm install
pnpm run build
```

You can run the CLI using `node packages/cli/dist/cli.js` or by linking it globally.

## Global Options

All commands support the following global options:

- `-h, --host <url>`: Orchestrator WebSocket URL (default: `ws://localhost:9000`). Can also be set via the `ORCH_HOST` environment variable.
- `-t, --token <jwt>`: Authentication token. Can also be set via the `ORCH_TOKEN` environment variable.

Example:
```bash
orch process list --host ws://127.0.0.1:9001 --token eyJhbG...
```

---

## Command Groups

### 1. Process Management (`process`)

Manage long-running processes and workloads.

- `orch process start <workspaceId> <command>`: Start a new process.
  - `-a, --args <args>`: Comma-separated arguments.
  - `-e, --env <env>`: Comma-separated KEY=VALUE environment variables.
- `orch process stop <workspaceId> <pid>`: Stop a running process.
- `orch process list [workspaceId]`: List all processes (optionally filtered by workspace).
- `orch process logs <workspaceId> <pid>`: Stream logs for a process.

### 2. Container Management (`container`)

Manage Docker containers.

- `orch container start <workspaceId> <image>`: Start a new container.
  - `-n, --name <name>`: Container name.
  - `-p, --ports <ports>`: Comma-separated port mappings (e.g., `8080:80`).
  - `-e, --env <env>`: Comma-separated KEY=VALUE environment variables.
- `orch container stop <workspaceId> <containerId>`: Stop a running container.
- `orch container list [workspaceId]`: List all containers.
- `orch container logs <workspaceId> <containerId>`: Stream logs for a container.

### 3. Secrets Vault (`vault`)

Manage encrypted secrets and environment variables.

- `orch vault set <workspaceId> <key> <value>`: Set a secret.
- `orch vault get <workspaceId> <key>`: Get a secret.
- `orch vault delete <workspaceId> <key>`: Delete a secret.
- `orch vault list <workspaceId>`: List all secret keys for a workspace.

### 4. Database Management (`db`)

Provision and query databases.

- `orch db provision -w <workspaceId> [-d <description>]`: Provision a new database.
- `orch db query -w <workspaceId> -d <dbId> -q <sql> [-p <params>]`: Execute a SQL query.
- `orch db disconnect -w <workspaceId> -d <dbId>`: Disconnect a database.

### 5. Authentication & Users (`auth`)

Manage users, roles, and JWT providers.

- `orch auth login -e <email> -p <password>`: Login to obtain a JWT token.
- `orch auth user-create -e <email> -p <password> [-r <roles>]`: Create a new user.
- `orch auth user-update-roles -e <email> -r <roles>`: Update roles for a user.
- `orch auth user-update-password -e <email> -p <password>`: Update password for a user.
- `orch auth user-list`: List all users.
- `orch auth provider-add -n <name> -i <issuer> -j <jwks>`: Add a new JWT provider.
- `orch auth provider-remove -i <id>`: Remove a JWT provider.
- `orch auth provider-list`: List all JWT providers.

### 6. AI Agents (`agent`)

Interact with AI agents.

- `orch agent invoke <role> <message>`: Invoke an agent and stream the response.

### 7. Daemon Management (`daemon`)

Manage the Orchestrator Daemon itself.

- `orch daemon status`: Get the health status of the daemon.
- `orch daemon metrics`: Get system metrics (CPU, memory, etc.).
