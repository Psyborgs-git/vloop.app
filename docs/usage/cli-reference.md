# CLI Reference

The `orch` command-line tool is the primary interface for managing vloop.

## Global Options

These options apply to all commands:

*   `-h, --host <url>`: Orchestrator WebSocket URL (default: `ws://localhost:9000` or `ORCH_HOST` env var).
*   `-t, --token <jwt>`: Authentication token (default: `ORCH_TOKEN` env var).
*   `-v, --version`: Output the version number.
*   `--help`: Display help for command.

## `orch auth`

Manage users, sessions, and JWT providers.

*   `login -e <email> -p <password>`: Authenticate and receive a token.
*   `user-create -e <email> -p <password> [-r <roles>]`: Create a new user (admin only).
*   `user-update-roles -e <email> -r <roles>`: Update user roles.
*   `user-update-password -e <email> -p <password>`: Change a user's password.
*   `user-list`: List all users.
*   `provider-add -n <name> -i <issuer> -j <jwks>`: Register a new OIDC provider.
*   `provider-remove -i <id>`: Remove a provider.
*   `provider-list`: List registered providers.

## `orch agent`

Interact with AI agents and workflows.

*   `run <workspaceId> <prompt>`: Execute a one-off task using the default or specified agent.
*   `chat --agent <id>`: Start an interactive chat session with an agent.
*   `create ...`: Create a new agent configuration (see `orch agent create --help`).
*   `list`: List available agents.

## `orch process`

Manage background processes (LRPs).

*   `spawn <id> <cmd> [args...]`: Start a new process.
*   `ls`: List all running processes.
*   `stop <id>`: Stop a process (SIGTERM).
*   `kill <id>`: Force kill a process (SIGKILL).
*   `logs <id> [--tail n]`: Stream logs from a process.

## `orch container`

Manage Docker containers.

*   `ls`: List active containers.
*   `pull <image>`: Pull a container image from a registry.
*   `run --name <name> --image <image> ...`: Start a new container.
*   `stop <id>`: Stop a running container.
*   `rm <id>`: Remove a container.
*   `logs <id>`: Stream logs.
*   `inspect <id>`: View detailed container metadata.

## `orch vault`

Manage encrypted secrets.

*   `put <path> <value>`: Store a secret.
*   `get <path>`: Retrieve a secret.
*   `delete <path>`: Delete a secret.
*   `list [prefix]`: List secrets by path.

## `orch db`

Manage databases.

*   `provision -w <workspace> [-d <desc>]`: Create a new internal SQLite DB.
*   `ext register ...`: Connect to an external Postgres/MySQL DB.
*   `query -w <workspace> -d <db> -q <sql>`: Run a SQL query.
*   `disconnect -w <workspace> -d <db>`: Close a database connection.

## `orch terminal`

Manage PTY sessions.

*   `spawn --id <id> [--shell <shell>]`: Create a new terminal session.
*   `send --id <id> --cmd <cmd>`: Send input to a session.
*   `attach <id>`: Connect interactively to a session (Coming Soon).
*   `ls`: List active terminal sessions.

## `orch daemon`

Manage the background service.

*   `install`: Install vloop as a system service (systemd/launchd/windows service).
*   `uninstall`: Remove the system service.
*   `start`: Start the installed service.
*   `stop`: Stop the service.
*   `status`: Check daemon health.
*   `logs`: View daemon logs.
