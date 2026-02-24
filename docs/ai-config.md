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

## API Actions (`agent` topic)

### CRUD (all entities)
- `provider.create/list/get/update/delete`
- `model.create/list/get/update/delete`
- `tool.create/list/get/update/delete`
- `config.create/list/get/update/delete` (agent configs)
- `workflow.create/list/get/update/delete`
- `chat.create/list/get/update/delete/history`
- `memory.add/list/search/delete`

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
