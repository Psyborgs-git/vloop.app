# AI Configuration System

The AI configuration system provides a full-stack interface for managing AI providers, models, tools, agents, workflows, chats, and memory.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                    Web UI                        │
│  AIConfigView → CRUD tabs for all entities       │
│  ChatView → uses agent configs for chat          │
├─────────────────────────────────────────────────┤
│                 @orch/client                      │
│  AgentClient → ~35 typed methods                 │
├─────────────────────────────────────────────────┤
│            @orch/orchestrator                     │
│  Router → "agent" topic → handler dispatch       │
├─────────────────────────────────────────────────┤
│              @orch/ai-agent                       │
│  ┌──────────────────────────────────────────┐    │
│  │ config/types.ts     — branded IDs + types│    │
│  │ config/migrations.ts — 8 SQLite tables   │    │
│  │ config/store.ts     — typed CRUD repo    │    │
│  ├──────────────────────────────────────────┤    │
│  │ config/provider-registry.ts              │    │
│  │ config/agent-builder.ts                  │    │
│  │ config/workflow-runner.ts                │    │
│  │ config/memory-store.ts                   │    │
│  ├──────────────────────────────────────────┤    │
│  │ orchestrator.ts  — Google ADK engine     │    │
│  │ handler.ts       — ~30 actions           │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

## Dependency Change

Replaced 4 Vercel AI SDK packages with a single dependency:

| Removed                | Added          |
|------------------------|----------------|
| `ai`                   | `@google/adk`  |
| `@ai-sdk/openai`      |                |
| `@ai-sdk/anthropic`   |                |
| `ollama-ai-provider`  |                |

## Entities

| Entity      | Table              | Description                                    |
|-------------|--------------------|------------------------------------------------|
| Provider    | `ai_providers`     | API endpoint config (Google, OpenAI, etc.)     |
| Model       | `ai_models`        | Model ID + parameters bound to a provider      |
| Tool        | `ai_tools`         | Custom tool definitions (builtin/script/api)   |
| Agent       | `ai_agents`        | Model + prompt + tools composition             |
| Workflow    | `ai_workflows`     | Sequential/parallel/loop agent orchestration   |
| Chat Session| `ai_chat_sessions` | Persistent chat session metadata               |
| Chat Message| `ai_chat_messages` | Individual messages with tool call tracking     |
| Memory      | `ai_memories`      | Cross-session knowledge entries                |
| MCP Server  | `ai_mcp_servers`   | External Model Context Protocol servers        |

## API Actions (`agent` topic)

### CRUD (all entities)
- `provider.create/list/get/update/delete`
- `model.create/list/get/update/delete`
- `tool.create/list/get/update/delete`
- `config.create/list/get/update/delete` (agent configs)
- `workflow.create/list/get/update/delete`
- `chat.create/list/get/update/delete/history`
- `memory.add/list/search/delete`
- `mcp.create/list/get/update/delete`

### Execution
- `chat.send` — send message to a chat session (streaming)
- `run.chat` — run agent chat with specific config (streaming)
- `run.workflow` — run a stored workflow (streaming)
- `workflow` — legacy prompt-based workflow (streaming)

## UI

Navigate to **AI Config** in the sidebar. The tabbed view provides:
- **Providers** — table with color-coded type chips
- **Models** — table with provider resolution
- **Tools** — table with handler type indicators
- **Agents** — card layout with model/tool chips and prompt preview
- **Workflows** — cards with type badge, step count, and run button
- **Memory** — searchable list with add/delete

Navigate to **MCP Config** in the sidebar to manage external MCP servers:
- **MCP Servers** — table with transport type chips and connection details

## Testing Notes

- `test_api.mjs` is a backend/API smoke test for auth, workflow CRUD, chat, and workflow execution.
- `test_features.mjs` is an end-to-end tool-calling test for agent chat streams.
- `test_ui.mjs` now uses `TEST_UI_BASE_URL` (defaults to `https://localhost:3000`) so it works with the current Vite dev server settings.

## Troubleshooting

- **Ollama sync can fail with foreign-key errors** when stale model configs are still referenced by existing agents/sessions. Sync now skips deleting referenced models and continues.
- **Tool-calling depends on model capabilities.** Some local models can chat but do not support tool/function calling, and agent tool tests will fail until a compatible model is selected.
