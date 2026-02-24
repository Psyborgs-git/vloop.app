# PRD: AI Agent Orchestrator (FS-6)

## 1. Objective
Build the `@orch/ai-agent` package. This package is the "brain" execution frame. It provides a secure, deterministic sandbox for LLM agent routines (e.g., ReAct, Plan-and-Execute) to execute code, call tools, and interact with the local host environment using the Orchestrator's internal APIs (Containers, Processes, Databases).

## 2. Requirements

### Functional
1. **Sandbox Environment**: Execute ad-hoc Javascript/TypeScript or sandbox scripts securely inside an isolated context (e.g., Node `vm` or a dedicated child process with dropped privileges).
2. **Tool Provisioning**: Expose the Orchestrator's capabilities as formal "Tools" or "Functions" conforming to JSON Schema outlines that modern LLMs (OpenAI, Anthropic, Gemini) can understand.
   - Example Tool: `create_container`, `query_database`, `spawn_process`, `read_file`.
3. **Memory & Context**: Manage conversation histories and workflow state, persisting scratchpads to the Database Manager.
4. **State Machine Iteration**: Provide an execution loop capable of parsing LLM tool calls, invoking the local Orchestrator subsystem, and yielding the results back to the LLM.

### Non-Functional
1. **Security (Critical)**: An agent running a prompt injection attack must not be able to bypass the Router's RBAC validation or access Orchestrator memory. The AI Agent domain invokes internal handlers as a restricted "Virtual Identity" by routing all tool calls through `router.dispatch` with an injected session context.
2. **Observability**: Every single tool call invoked by the agent must be logged structurally to the Audit system (e.g., "Agent X requested to drop table Users").
3. **Modularity**: The AI core should be agnostic of the specific LLM provider. The logic maps generic "Tool Calling" to our internal TS methods.

## 3. Interfaces
- `AgentOrchestrator`: The main class managing workflow loops and memory stores.
- `ToolRegistry`: Maps JSON Schemas (`name`, `description`, `properties`) to internal Orchestrator function references.
- `SandboxContext`: The tightly controlled JS execution frame if arbitrary code execution is permitted.

## 4. Scope Boundaries
The actual HTTP calls to closed-weight model APIs (OpenAI, Anthropic) or local model endpoints (Ollama) will be executed here. We will orchestrate the sequence logic, not build our own neural networks.
