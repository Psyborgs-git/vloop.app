# vloop — Autonomous AI & System Orchestrator

**vloop** is a secure, privacy-first orchestration daemon designed to empower AI agents with direct, controlled access to your local system's capabilities. It acts as a bridge between high-level AI logic and low-level system operations, enabling you to build, deploy, and manage autonomous workflows that can execute shell commands, manage Docker containers, query databases, and securely store secrets.

Built on a robust, multi-tenant architecture, vloop provides a unified interface for both human operators (via CLI and Web UI) and machine agents (via MCP and WebSocket API), ensuring that every action is authenticated, authorized, and audited.

## Core Value Proposition

*   **System-Native Agency**: Grant AI agents the ability to spawn processes, manage containers, and manipulate files within a secure sandbox.
*   **Privacy-First Architecture**: Your data stays local. All secrets are encrypted at rest using AES-256-GCM, and the system is designed to run entirely on your own infrastructure.
*   **Unified Control Plane**: Manage long-running processes (LRPs), cron jobs, Docker containers, and database connections from a single CLI or API.
*   **Granular Access Control**: Role-Based Access Control (RBAC) and strict policy enforcement ensure that agents only have access to the resources they need.
*   **Developer-Friendly**: Extensible via plugins (Node.js/Python) and fully compatible with the Model Context Protocol (MCP).

## Target Audience

*   **AI Engineers**: Building autonomous agents that need real-world execution capabilities beyond simple text generation.
*   **DevOps Engineers**: Automating local development environments, CI/CD pipelines, and infrastructure management tasks.
*   **Power Users**: Orchestrating complex workflows involving multiple tools, databases, and services on their local machine or private server.

## Documentation Structure

### [Getting Started](./getting-started/installation.md)
*   [Installation](./getting-started/installation.md): Set up vloop on your machine.
*   [Quickstart](./getting-started/quickstart.md): Run your first autonomous AI workflow in 5 minutes.
*   [Plugin Development](./getting-started/plugin.md): Create custom plugins to extend functionality.

### [Architecture](./architecture/overview.md)
*   [System Overview](./architecture/overview.md): High-level design and component interaction.
*   [Data Flow](./architecture/data-flow.md): Lifecycle of a request and security boundaries.
*   [AI Agent Migration (2026-03)](./architecture/ai-agent-migration-2026-03.md): Consolidation of ai-agent ownership, app entrypoint unification, and dedicated MCP server port.
*   [Typed App Lifecycle Migration (2026-03)](./architecture/typed-app-lifecycle-migration-2026-03.md): Hard cutover to `AppComponent`, self-managed package lifecycle, secured restart control plane, and orchestrator gateway cleanup.
*   [MCP Split & Persistent Tokens (2026-03)](./architecture/mcp-split-persistent-tokens-2026-03.md): Extraction of `@orch/mcp-server` component, persistent API token model, and unified auth middleware.

### Features
*   [Security & Auth](./features/security.md): Authentication, RBAC, Vault, and Audit Logging.
*   [Process Management](./features/process-management.md): Managing background processes and cron jobs.
*   [Container Orchestration](./features/container-management.md): Docker integration and lifecycle management.
*   [AI Orchestration](./features/ai-orchestration.md): Agents, Tools, Workflows, and MCP.
*   [Canvas Runtime](./features/canvas.md): Dynamic canvas hosting, realtime state sync, and injected IPC client.
*   [Database Management](./features/database-management.md): Provisioning and querying SQL databases.
*   [Terminal Sessions](./features/terminal-sessions.md): Secure, persistent PTY sessions.
*   [Plugins](./features/plugins.md): extending functionality.

### Usage
*   [CLI Reference](./usage/cli-reference.md): Comprehensive command documentation.
*   [Examples](./usage/examples.md): Real-world use cases and recipes.

### [Contributing](./contributing/guidelines.md)
*   [Guidelines](./contributing/guidelines.md): Development setup, testing, and contribution process.
