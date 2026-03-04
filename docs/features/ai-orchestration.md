# AI Orchestration

vloop transforms your local system into a powerful environment for autonomous AI agents. The AI Agent subsystem (`@orch/ai-agent`) manages the lifecycle of agents, tools, workflows, and integrations with external models. The MCP HTTP transport is handled by a separate `@orch/mcp-server` component.

## Architecture (v2)

The v2 AI orchestration engine uses a **repo-backed, DAG-native** architecture:

- **15 Drizzle ORM repositories** for all persistence (providers, models, tools, MCP servers, agents, workflows, sessions, messages, state nodes, executions, worker runs, HITL waits, audit events, memories, canvases)
- **DAG-native message tracking** with `parentId` pointers enabling branching, forking, and rerunning without destroying history
- **ProviderManager** for cached model resolution with vault-backed API key retrieval
- **MCPManager** for dynamic MCP tool injection from configured servers
- **StateAdapter** for execution DAG tracking (state nodes per execution step)
- **WorkerDispatcher** for durable worker-thread execution of long-running workflows
- **Google ADK** as the underlying agent runtime (`LlmAgent`, `InMemoryRunner`)

### Key Design Decisions

| Decision | Choice |
|---|---|
| Persistence | Individual Drizzle repos (no monolithic config store) |
| Message model | DAG with `parentId` + `branch` (not flat array) |
| Execution tracking | State nodes per step with checkpoint/rollback |
| Worker isolation | Single worker thread per execution with queueing |
| Schema migration | Idempotent DDL (`CREATE IF NOT EXISTS`) at startup |
| Provider secrets | Vault references (`apiKeyRef`) resolved at runtime |

## Core Concepts

### 1. Agents
An **Agent** is a configured identity with a specific purpose. It consists of:
*   **System Prompt**: Defines the agent's persona and instructions.
*   **Model**: The underlying LLM (e.g., GPT-4, Claude 3.5, Llama 3).
*   **Tools**: A set of capabilities the agent can invoke (e.g., `terminal_execute`, `spawn_container`).
*   **MCP Servers**: External tool providers connected via the Model Context Protocol.
*   **Memory**: Session-scoped conversation history with DAG branching.

### 2. Tools
Tools are the hands of the agent. They are executable functions that perform actions on the system. vloop provides several built-in tools:
*   `terminal_execute`: Run shell commands.
*   `spawn_process`: Manage background processes.
*   `spawn_container`: Manage Docker containers.
*   `browser_automation`: Control a headless browser (via Playwright).
*   `agent_search`: Find other agents to collaborate with.

Custom tools can be registered via the Tool CRUD API with `builtin` or `api` handler types.

### 3. Workflows
Workflows allow you to chain multiple agents and steps together using a DAG structure.
*   **Nodes**: Individual workflow steps (LLM calls, tool calls, conditions).
*   **Edges**: Connections between nodes defining execution order.
*   **Versioning**: Each workflow can have multiple versions with activation/deactivation tracking.
*   **Execution**: Runs in an isolated worker thread with state persistence.

### 4. Sessions & Messages (DAG)
Chat sessions track conversations as a **directed acyclic graph**:
*   Each message has a `parentId` pointing to its predecessor.
*   Sessions have a `headMessageId` pointer to the latest message.
*   **Branching**: New responses create sibling branches from the same parent.
*   **Forking**: Creates a new session with a copy of the message ancestry.
*   **Rerunning**: Creates a new branch from the parent of the target message without deleting history.

### 5. Canvases
Canvases provide a runtime surface for AI-generated UIs with:
*   Full CRUD with owner-based filtering.
*   Automatic commit history on content changes.
*   Rollback to any previous commit.
*   Real-time state sync via the Canvas Server (WebSocket IPC).

## Model Context Protocol (MCP)

vloop fully supports the **Model Context Protocol (MCP)**, an open standard for connecting AI models to external data and tools.

*   **MCP Server**: vloop exposes its internal tools (terminal, docker, etc.) as an MCP server served from a **dedicated MCP port** (`network.mcp_port`, default `9446`) and initialized from `@orch/ai-agent`. This allows *external* MCP clients (like Claude Desktop or other agents) to securely control your vloop instance.
*   **MCP Client**: vloop agents can connect to *other* MCP servers (stdio or SSE transport) running locally or remotely, expanding their capabilities dynamically. MCP servers are managed via the MCP Server CRUD API and can be attached per-agent or per-session.

## Configuration

Agents and tools are defined in the database and managed via the CLI or WebSocket API.

### Creating an Agent

```bash
orch agent create \
  --name "devops-bot" \
  --model "claude-3-5-sonnet" \
  --system-prompt "You are an expert DevOps engineer. Manage my local containers." \
  --tools "spawn_container,inspect_container,terminal_execute"
```

### Running a Session

You can interact with an agent in a persistent chat session:

```bash
# Start a new chat
orch agent chat --agent "devops-bot"

# In the interactive shell:
> "List all running containers and stop any that are using port 8080."
```

### DAG Operations

```bash
# Fork a conversation from a specific message
orch agent chat fork --session <id> --message <messageId> --title "Forked exploration"

# Rerun from a message (creates a new branch, original is preserved)
orch agent chat rerun --session <id> --message <messageId>

# Compact context (summarize older messages to save token budget)
orch agent chat compact --session <id>
```

## Provider Support

vloop is model-agnostic and supports:
*   **Ollama** (Local, Private)
*   **OpenAI** (GPT-4o, etc.)
*   **Anthropic** (Claude 3.5 Sonnet, Haiku)
*   **Google** (Gemini 1.5 Pro/Flash)
*   **Groq** (Llama 3 70b, fast inference)

Providers are managed via the Provider CRUD API. Each provider has its own authentication configuration (API key refs stored in the Vault, bearer tokens, or no auth for local models).

## CRUD API Surface

All operations are available via the `agent.*` WebSocket action namespace:

| Namespace | Actions |
|---|---|
| `provider.*` | create, list, get, update, delete |
| `model.*` | create, list, get, update, delete |
| `tool.*` | create, list, get, update, delete |
| `mcp.*` | create, list, get, update, delete |
| `config.*` | create, list, get, update, delete (agent configs) |
| `workflow.*` | create, list, get, update, delete |
| `chat.*` | create, list, get, update, delete, history, send, rerun, fork, compact |
| `memory.*` | add, list, search, delete |
| `canvas.*` | list, get, create, update, delete, commits, rollback |
| `run.*` | chat, workflow |
| `session.tools.*` | get, set |
| `agent.tools.*` | get, set |

## Related Runtime Surface

For dynamic AI-generated UIs and realtime backend/frontend state sync, see the [Canvas Runtime](./canvas.md).

## Migration Notes

For a complete record of the architectural migration completed in this session (app-entrypoint unification, MCP/canvas ownership consolidation, startup fixes, and dedicated MCP port), see:

- [AI Agent & Orchestrator Migration Notes (2026-03)](../architecture/ai-agent-migration-2026-03.md)
