# AI Orchestration

vloop transforms your local system into a powerful environment for autonomous AI agents. The AI Agent subsystem (`@orch/ai-agent`) manages the lifecycle of agents, tools, workflows, and integrations with external models.

## Core Concepts

### 1. Agents
An **Agent** is a configured identity with a specific purpose. It consists of:
*   **System Prompt**: Defines the agent's persona and instructions.
*   **Model**: The underlying LLM (e.g., GPT-4, Claude 3.5, Llama 3).
*   **Tools**: A set of capabilities the agent can invoke (e.g., `terminal_execute`, `spawn_container`).
*   **Memory**: Short-term conversation history and long-term vector storage (RAG).

### 2. Tools
Tools are the hands of the agent. They are executable functions that perform actions on the system. vloop provides several built-in tools:
*   `terminal_execute`: Run shell commands.
*   `spawn_process`: Manage background processes.
*   `spawn_container`: Manage Docker containers.
*   `browser_automation`: Control a headless browser (via Playwright).
*   `agent_search`: Find other agents to collaborate with.

### 3. Workflows
Workflows allow you to chain multiple agents and steps together.
*   **Sequential**: Step A -> Step B -> Step C.
*   **Parallel**: Run multiple agents concurrently and aggregate results.
*   **Loop**: Repeat a task until a condition is met.
*   *(Note: Workflow editor support is currently in development)*.

## Model Context Protocol (MCP)

vloop fully supports the **Model Context Protocol (MCP)**, an open standard for connecting AI models to external data and tools.

*   **MCP Server**: vloop exposes its internal tools (terminal, docker, etc.) as an MCP server. This allows *external* MCP clients (like Claude Desktop or other agents) to securely control your vloop instance.
*   **MCP Client**: vloop agents can connect to *other* MCP servers running locally or remotely, expanding their capabilities dynamically.

## Configuration

Agents and tools are defined in the database but can be managed declaratively via the CLI.

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

## Provider Support

vloop is model-agnostic and supports:
*   **Ollama** (Local, Private)
*   **OpenAI** (GPT-4o, etc.)
*   **Anthropic** (Claude 3.5 Sonnet, Haiku)
*   **Google** (Gemini 1.5 Pro/Flash)
*   **Groq** (Llama 3 70b, fast inference)

## Related Runtime Surface

For dynamic AI-generated UIs and realtime backend/frontend state sync, see the [Canvas Runtime](./canvas.md).
