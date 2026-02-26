# Plugins

vloop supports a plugin system that allows you to extend the core functionality with custom capabilities. Plugins run as separate child processes, ensuring isolation and stability.

## Supported Languages

*   **Node.js**: Full access to the vloop SDK and Node.js ecosystem.
*   **Python**: Ideal for data science, AI model integration, and scripting.

## Plugin Capabilities

Plugins can:
*   **Register Tools**: Add new tools to the agent ecosystem (e.g., `slack_send_message`, `jira_create_ticket`).
*   **Subscribe to Events**: Listen for system events (e.g., "container started", "workflow finished") and trigger actions.
*   **Expose API Endpoints**: Add custom routes to the vloop API.

## Managing Plugins

*(Note: Plugin management CLI commands are currently in active development)*

### Structure

A plugin is a directory containing a `plugin.json` manifest and the source code.

**plugin.json**:
```json
{
  "name": "my-slack-plugin",
  "version": "1.0.0",
  "main": "index.js",
  "permissions": [
    "network:outbound"
  ]
}
```

### Installation

Plugins are installed into the `plugins/` directory of your vloop workspace. The daemon automatically discovers and loads them on startup.
