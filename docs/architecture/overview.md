# System Architecture Overview

vloop is built as a modular, monolithic daemon (`@orch/daemon`) that integrates various subsystems into a cohesive orchestration platform. It follows a "hub-and-spoke" model where the central daemon manages communication, security, and lifecycle for all connected components.

## High-Level Design

The system is composed of the following key layers:

1.  **Interface Layer**:
    *   **CLI (`@orch/cli`)**: The primary command-line tool for operators.
    *   **Web UI (`@orch/web-ui`)**: A React-based dashboard for visual management.
    *   **MCP Server**: An integrated Model Context Protocol server for AI agent connectivity.
    *   **WebSocket API**: The real-time, bidirectional communication channel used by all clients.

2.  **Core Daemon (`@orch/daemon` & `@orch/orchestrator`)**:
    *   **Router**: Dispatches incoming messages to appropriate feature handlers.
    *   **Security Kernel**: Enforces Authentication (JWT), Authorization (RBAC), and Audit Logging.
    *   **Service Manager**: Manages the lifecycle of background services and plugins.

3.  **Feature Subsystems**:
    *   **Process Manager (`@orch/process`)**: Spawns and supervises OS-level processes.
    *   **Container Manager (`@orch/container`)**: Interfaces with the Docker Engine API.
    *   **AI Orchestrator (`@orch/ai-agent`)**: Manages LLM interactions, tools, and workflows.
    *   **Database Manager (`@orch/db-manager`)**: Provisions SQLite/Postgres/MySQL databases.
    *   **Terminal Manager (`@orch/terminal`)**: Manages persistent PTY sessions.
    *   **Vault (`@orch/vault`)**: Securely stores secrets using AES-256-GCM encryption.

4.  **Infrastructure Layer**:
    *   **Encrypted Storage**: All state is persisted in encrypted SQLite databases (`better-sqlite3-multiple-ciphers`).
    *   **System Resources**: Direct access to file system, network, and hardware (via Node.js APIs).

## Architecture Diagram

The following diagram illustrates how the core components interact within the vloop system:

```mermaid
graph TD
    subgraph Clients
        CLI[CLI tool]
        WebUI[Web dashboard]
        MCP[MCP clients]
    end

    subgraph "vloop Daemon"
        API[WebSocket API / Router]

        subgraph "Security kernel"
            Auth[Auth & session manager]
            RBAC[Policy engine]
            Audit[Audit logger]
        end

        subgraph "Orchestration engine"
            AgentOrch[AI‑agent orchestrator]
            ProcMgr[Process manager]
            ContMgr[Container manager]
            TermMgr[Terminal manager]
            DBMgr[Database manager]
        end

        subgraph "Data & state"
            Vault[(Encrypted vault)]
            StateDB[(State database)]
        end
    end

    subgraph "External systems"
        Docker[Docker engine]
        LLM["LLM providers (Ollama / OpenAI)"]
        OS[Operating system]
    end

    CLI -->|WebSocket| API
    WebUI -->|WebSocket| API
    MCP -->|SSE / stdio| API

    API --> Auth
    Auth --> RBAC
    RBAC --> Audit
    Audit --> AgentOrch
    Audit --> ProcMgr
    Audit --> ContMgr
    Audit --> TermMgr
    Audit --> DBMgr

    ProcMgr -->|spawn / kill| OS
    ContMgr -->|API| Docker
    TermMgr -->|PTY| OS
    AgentOrch -->|inference| LLM

    AgentOrch --> StateDB
    Vault -.->|inject secrets| ProcMgr
    Vault -.->|inject secrets| ContMgr
    Vault -.->|API keys| AgentOrch
```

## Key Architectural Decisions

*   **Modular Monolith**: While logically separated into packages, the core system runs as a single process to minimize latency and operational complexity.
*   **Encrypted-by-Default**: The system assumes it is running in a potentially hostile environment (e.g., a shared dev machine), so all persistent state is encrypted at rest.
*   **Event-Driven**: The internal architecture heavily relies on event emitters and WebSocket messages, enabling real-time updates for all connected clients.
*   **Policy-as-Code**: Access control is defined in TOML configuration files, allowing for transparent and version-controlled security policies.
