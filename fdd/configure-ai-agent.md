# Feature Specification: Configure the tools of an AI agent

## 1. Feature Metadata & FDD Naming
* **Feature Statement:** Configure the tools of an AI agent
* **Feature Set / Subject Area:** AI & LLM Integration (`@orch/ai-agent`)
* **Priority & Target Release:** High / P0 (Autonomous Capability)

## 2. Business Context & Value (The "Why")
Providing native autonomous capabilities within an orchestrator is a distinct competitive advantage for OSS platforms. By securely coupling advanced Local LLMs (Ollama) or external APIs with structured Model Context Protocol (MCP) tools, AI agents can inspect containers, read secure vault secrets, interact with terminal sessions, and trigger automated self-healing. This feature ensures that tool resolution, execution workflows, and logging are highly robust and scale dynamically.

## 3. File Manifest & Architecture Impact (The "Where")
* **Files (v2 architecture):**
  * `packages/ai-agent/src/v2/handler.ts`: Action-string router — maps incoming `agent.*` actions to the correct repo or orchestrator method.
  * `packages/ai-agent/src/v2/orchestrator.ts`: `AgentOrchestratorV2` — uses `@jaex/dstsx` `Predict`/`ReAct` modules, runs chat/workflow sessions, fork/rerun/compact operations, DAG message tracking.
  * `packages/ai-agent/src/v2/repos/*.ts`: Drizzle-backed repos for every domain entity (ProviderRepo, ModelRepo, ToolRepo, McpServerRepo, AgentRepo, WorkflowRepo, SessionRepo, MessageRepo, ExecutionRepo, StateNodeRepo, WorkerRunRepo, HitlWaitRepo, AuditEventRepo, MemoryRepo, CanvasRepo).
  * `packages/ai-agent/src/v2/canvas-handlers.ts`: Registers `canvas.*` CRUD actions backed by `CanvasRepo`.
  * `packages/ai-agent/src/v2/schema.ts`: Drizzle table definitions for all 15+ tables.
  * `packages/ai-agent/src/v2/migration.ts`: SQL DDL migration for the full v2 schema.
  * `packages/ai-agent/src/v2/types.ts`: Shared type definitions (ResolvedModel, etc.).
  * `packages/ai-agent/src/config/lm-factory.ts`: LM adapter factory — maps provider types to `@jaex/dstsx` adapters (`OpenAI`, `Anthropic`, `GoogleAI`, `Ollama`).
* **Dependencies:** `@jaex/dstsx`, `@modelcontextprotocol/sdk`, `ollama`, `better-sqlite3-multiple-ciphers`, `drizzle-orm`, `vitest`.

## 4. Design by Feature (The "How")
* **Domain Object Model Impact:** Introduces Drizzle schemas for providers, models, tools, MCP servers, agent configs, workflows, sessions, messages (DAG with `parentId`/`branch`), executions, state nodes, worker runs, HITL waits, audit events, memory entries, canvases, and canvas commits.
* **Sequence of Operations:**
  1. User/System triggers a run context (`chat.send`, `run.chat`, or `run.workflow`).
  2. `AgentOrchestratorV2` resolves the agent config from `AgentRepo`, creates a `@jaex/dstsx` LM adapter via `createLM()` with resolved tools and optional MCP servers.
  3. MCP servers are resolved via `MCPManager` with parallel stdio/SSE connection setup, returning `dstsx.Tool[]`.
  4. The `createLM()` factory maps the provider type to the correct `@jaex/dstsx` adapter (`OpenAI`, `Anthropic`, `GoogleAI`, `Ollama`).
  5. `Predict.stream()` or `ReAct.forward()` runs the completion within a `settings.context()` scope. Each chunk or tool call is persisted as a message in the DAG (with `parentId` tracking).
  6. Audit events are written to `AuditEventRepo` for every execution step, enabling full replay and observability.
  7. For workflow execution, `StateNodeRepo` tracks DAG state transitions and `WorkerRunRepo` records individual worker execution windows.
* **Edge Cases & Error Handling:**
  * LLM Hallucinations: Invalid tool calls result in an error event persisted in audit logs with the full call context.
  * MCP Server Timeouts: Handled within MCPManager with configurable timeout; failures are surfaced as tool-error events.
  * HITL (Human-in-the-Loop): `HitlWaitRepo` pauses execution until a human resolves the wait with an approval/rejection + optional response.
  * Message DAG Integrity: Fork and rerun operations copy ancestry chains atomically, preserving immutable history.

## 5. Large-Scale / OSS Methodology Guidelines
* **Backward Compatibility:** Root barrel exports provide compat aliases (`AgentOrchestrator` → `AgentOrchestratorV2`, `createAgentHandler` → `createAgentHandlerV2`). The wire protocol action strings are unchanged — existing clients and web-ui work without migration.
* **Feature Flagging:** LLM providers (e.g., local Ollama vs. external APIs) can be conditionally configured. Canvas handlers are only registered if `CanvasRepo` is passed. Tool call auditing can be throttled or purged via cron.
* **Security & Performance:** MCP server resolution is parallelized. All repo writes use single Drizzle transactions. AI Agents are restricted to the permissions embedded within their configuration profile. Vault-stored API keys are dereferenced at runtime only.

## 6. Testing & Acceptance Criteria (Build by Feature)
* **Unit Test Requirements:** All 15 repos tested via in-memory SQLite (`v2/__tests__/repos.test.ts`, `canvas-repo.test.ts`). Handler dispatch routing tested with mocked repos (`handler.test.ts`). Orchestrator fork/compact logic tested (`orchestrator.test.ts`). Total: 57 tests, 9 files.
* **Integration Test Requirements:** Run a basic workflow using mocked MCP servers and verify the complete request/response lifecycle alongside DB persistence.
* **Reviewer Checklist:**
  * [ ] Are MCP tool resolutions parallelized?
  * [ ] Are all repo writes transactional?
  * [ ] Does fork/rerun preserve full message ancestry?
  * [ ] Are canvas handlers conditionally registered?
  * [ ] Do all 57 tests pass (`pnpm vitest run packages/ai-agent/src/`)?
