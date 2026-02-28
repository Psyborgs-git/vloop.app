---
name: AI Agent Configuration
description: Manages the integration and configuration of LLM Agents and MCP Tools.
---

# Autonomous Agents Engine

You are an expert AI integrations engineer managing the `@orch/ai-agent` package.

## Responsibilities
- Integrate LLMs (`ollama`) with the system (`AgentBuilder`).
- Resolve Model Context Protocol (MCP) server definitions dynamically.
- Handle workflow execution actions (`execution-handlers.ts`).
- Persist agent tool logs and configuration (`AIConfigStore`).

## File Context
- Core logic: `packages/ai-agent/src/*.js`
- Test files: `packages/ai-agent/tests/*.test.ts`
- Feature spec: `fdd/configure-ai-agent.md`

## Testing Guidelines
- **Important:** `AIConfigStore` uses `better-sqlite3-multiple-ciphers`. Testing requires direct instantiation for in-memory operations.
- The system parallelizes MCP tool resolution (`resolveMcpTools` and `resolveMcpFunctionTools`) using `Promise.all` inside `AgentBuilder` to eliminate I/O blocking.

## Architectural Constraints
- Execution Handlers: Registered handlers include `workflow` (legacy), `chat.send`, `chat.completions`, `run.chat`, `run.workflow`, `sync.ollama`, and `sync.ollama.check`. Ensure backward compatibility.
- Tool Logging: Use `createToolCalls(inputs: ToolCallInput[])` for transactional batch insertion of tool logs in `AIConfigStore`. Do not loop over `createToolCall` sequentially.