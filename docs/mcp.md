# Model Context Protocol (MCP)

The Orchestrator supports the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) to seamlessly integrate external tools and expose internal capabilities to AI agents.

## Overview

MCP allows AI models to interact with external systems in a standardized way. The Orchestrator acts as both an **MCP Client** and an **MCP Server**:

1. **MCP Client**: Connects to external MCP servers (via `stdio` or `sse`) to fetch tools and provide them to AI agents during workflows and chat sessions.
2. **MCP Server**: Exposes the Orchestrator's internal `ToolRegistry` (e.g., `spawn_process`, `spawn_container`, `terminal_execute`) to external MCP clients via Server-Sent Events (SSE).

## Configuring External MCP Servers

You can configure external MCP servers via the Web UI or the API. These servers provide tools that can be attached to Agents or Chat Sessions.

### Supported Transports

- **stdio**: Runs a local command as a subprocess and communicates over standard input/output.
- **sse**: Connects to a remote MCP server over HTTP using Server-Sent Events.

### Example: Adding a Stdio Server

```json
{
  "name": "Everything Server",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-everything"],
  "env": {
    "API_KEY": "secret"
  }
}
```

### Example: Adding an SSE Server

```json
{
  "name": "Remote Server",
  "transport": "sse",
  "url": "http://remote-server.com/mcp/sse"
}
```

## Using MCP Tools in Agents

When creating or updating an Agent or Chat Session, you can specify a list of `mcpServerIds`. The Orchestrator will automatically connect to these servers, fetch their tools, and inject them into the AI model's context.

```json
{
  "name": "My Agent",
  "modelId": "gpt-4o",
  "systemPrompt": "You are a helpful assistant.",
  "mcpServerIds": ["mcp-server-uuid-1", "mcp-server-uuid-2"]
}
```

## Local MCP Server

The Orchestrator exposes its own MCP server at the following endpoints:

- **SSE Endpoint**: `GET /mcp/sse`
- **Message Endpoint**: `POST /mcp/messages`

### Authentication

The local MCP server requires authentication using the existing Orchestrator session infrastructure. You must provide a valid session token either via the `Authorization` header or as a query parameter.

**Header:**
```
Authorization: Bearer <session_token>
```

**Query Parameter:**
```
GET /mcp/sse?token=<session_token>
```

### Exposed Tools

The local MCP server exposes all tools registered in the Orchestrator's `ToolRegistry`, including:

- `spawn_process`
- `spawn_container`
- `inspect_container`
- `terminal_execute`
- `browser_navigate`
- `browser_click`
- `browser_type`
- `browser_extract`

External MCP clients can connect to the Orchestrator's SSE endpoint to discover and execute these tools.
