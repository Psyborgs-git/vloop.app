# Feature Specification: Configure the tools of an AI agent

## 1. Feature Metadata & FDD Naming
* **Feature Statement:** Configure the tools of an AI agent
* **Feature Set / Subject Area:** AI & LLM Integration (`@orch/ai-agent`)
* **Priority & Target Release:** High / P0 (Autonomous Capability)

## 2. Business Context & Value (The "Why")
Providing native autonomous capabilities within an orchestrator is a distinct competitive advantage for OSS platforms. By securely coupling advanced Local LLMs (Ollama) or external APIs with structured Model Context Protocol (MCP) tools, AI agents can inspect containers, read secure vault secrets, interact with terminal sessions, and trigger automated self-healing. This feature ensures that tool resolution, execution workflows, and logging are highly robust and scale dynamically.

## 3. File Manifest & Architecture Impact (The "Where")
* **Files:**
  * `packages/ai-agent/src/execution-handlers.js`: Binds explicit execution actions (`chat.send`, `chat.completions`, `run.workflow`, `sync.ollama`).
  * `packages/ai-agent/src/agent-builder.js`: Core parallel resolution of MCP servers and system prompts.
  * `packages/ai-agent/src/config-store.js`: Database layer for agent prompts, tool logging, and configurations.
  * `packages/ai-agent/src/workflows.js`: Legacy action dispatch logic for basic AI loops.
* **Dependencies:** `@google/adk`, `@modelcontextprotocol/sdk`, `ollama`, `better-sqlite3-multiple-ciphers`, `vitest`.

## 4. Design by Feature (The "How")
* **Domain Object Model Impact:** Introduces schemas for `agent_configs`, `workflows`, and `tool_calls` (for audit and playback).
* **Sequence of Operations:**
  1. User/System triggers a run context (`chat.send` or `run.workflow`).
  2. `AgentBuilder` fetches the `agent_config` and runs `resolveMcpTools` and `resolveMcpFunctionTools` in parallel via `Promise.all` to reduce I/O bottlenecks.
  3. The chosen LLM provider synthesizes the request.
  4. If the LLM requests a tool call, the execution handler validates the call against the MCP definitions.
  5. The tool executes synchronously or asynchronously depending on the host implementation.
  6. `AIConfigStore` uses `createToolCalls(inputs)` to perform a transactional batch insertion of the execution logs, vastly improving performance over sequential inserts.
* **Edge Cases & Error Handling:**
  * LLM Hallucinations: Invalid tool calls emit an explicit execution failure logged in `tool_calls`.
  * MCP Server Timeouts: Safely handled within `AgentBuilder` via Promise timeouts.
  * Unsupported Capabilities: Fallback logic gracefully downgrades context window or prompts.

## 5. Large-Scale / OSS Methodology Guidelines
* **Backward Compatibility:** Must support the legacy `workflow` execution handler alongside new, discrete `chat.*` handlers.
* **Feature Flagging:** LLM providers (e.g., local Ollama vs. external APIs) can be conditionally configured. Tool call auditing can be throttled or purged via cron.
* **Security & Performance:** `Promise.all` resolution of MCP servers ensures low latency. Transactional `createToolCalls` must be used for all batch metric writes. AI Agents are restricted to the permissions embedded within their configuration profile.

## 6. Testing & Acceptance Criteria (Build by Feature)
* **Unit Test Requirements:** Must mock `@modelcontextprotocol/sdk` and `ollama` responses. Validate that `createToolCalls` correctly issues a single transaction batch insert.
* **Integration Test Requirements:** Run a basic workflow using mocked MCP servers and verify the complete request/response lifecycle alongside DB persistence.
* **Reviewer Checklist:**
  * [ ] Are MCP tool resolutions parallelized with `Promise.all`?
  * [ ] Are tool calls batch-inserted transactionally?
  * [ ] Are legacy `workflow` handlers preserved?
