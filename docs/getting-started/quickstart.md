# Quickstart: Your First AI Workflow

This guide will walk you through running a simple AI Agent workflow that interacts with your local system. We'll use vloop to spawn an agent that can execute shell commands to inspect your environment.

**Time required**: ~5 minutes

## Prerequisites
*   [vloop installed](./installation.md)
*   An API key for an LLM provider (e.g., OpenAI, Anthropic) OR a local Ollama instance running.

## Step 1: Login & Configure

First, ensure you are authenticated. If you haven't created a user yet, the CLI will guide you.

```bash
orch auth login
```

Next, configure your LLM provider. For this example, we'll assume you have a local **Ollama** instance running (it's free and private!).

```bash
# Check if Ollama is reachable
curl http://localhost:11434/api/tags

# The system auto-detects local Ollama models, but let's confirm
orch agent provider list
```

*If you prefer OpenAI:*
```bash
orch vault put secrets/openai_key sk-...
orch agent provider create --name "openai" --type "openai" --api-key-ref "secrets/openai_key"
```

## Step 2: Create an Agent

Let's define a "System Inspector" agent. This agent will have permission to use the `terminal` tool to run read-only commands.

```bash
# Create the agent configuration
orch agent create \
  --name "inspector" \
  --model "llama3" \
  --system-prompt "You are a helpful system inspector. You can run terminal commands to answer user questions. Be concise." \
  --tools "terminal_execute"
```

## Step 3: Run the Workflow

Now, let's ask our agent to do some work. We'll use the `run` command, which creates an ephemeral workflow for this task.

```bash
orch agent run "Check the current directory and list the files. Then tell me which file is the largest."
```

**What happens under the hood?**

1.  **Plan**: The agent receives your prompt.
2.  **Tool Call**: It decides to run `ls -la` (or equivalent) using the `terminal_execute` tool.
3.  **Execution**: vloop intercepts the tool call, validates permissions (you might be prompted to approve if strict mode is on), and executes the command in a secure PTY.
4.  **Observation**: The output of `ls` is fed back to the agent.
5.  **Reasoning**: The agent parses the file list, identifies the largest file, and generates a final response.
6.  **Response**: "The largest file in this directory is `video.mp4` (1.2GB)."

## Next Steps

*   Explore [AI Orchestration](../features/ai-orchestration.md) to learn about persistent chat sessions and complex workflows.
*   Check out [Process Management](../features/process-management.md) to learn how to schedule this agent to run every morning via Cron.
