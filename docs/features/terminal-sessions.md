# Terminal Sessions

The Terminal subsystem (`@orch/terminal`) provides secure, persistent pseudoterminal (PTY) sessions. This allows users and agents to interact with the underlying operating system shell (bash, zsh, powershell) in a controlled manner.

## Key Features

*   **Persistence**: Sessions remain active even if the client disconnects. You can re-attach to a running session later.
*   **Cross-Platform**: Works on Linux, macOS, and Windows.
*   **Multiplexing**: Multiple clients can view/control the same session (useful for collaboration or supervision).
*   **Audit Trail**: All input and output is logged for security review.

## Architecture

vloop uses `node-pty` to spawn the shell process. The daemon manages the PTY master/slave relationship and streams data over WebSocket to the client.

### Security Model

*   **Input Filtering**: The system can enforce allow/block lists for commands (e.g., blocking `rm -rf /` or `sudo`).
*   **User Isolation**: Sessions run as the user executing the daemon (or a specified user if running as root/admin).
*   **Strict Mode**: Require human approval for potentially dangerous commands.

## Usage

### CLI

**Start a new session**:
```bash
# Spawns a new shell (defaults to $SHELL or cmd.exe)
orch terminal spawn --id "term-1"
```

**Send a command**:
```bash
orch terminal send --id "term-1" --cmd "ls -la"
```

**Attach interactively**:
*(Coming soon: Full interactive TTY support in CLI)*

### Agent Integration

Agents use the `terminal_execute` tool.

1.  Agent calls `terminal_execute(command="npm install")`.
2.  vloop creates a temporary session (or uses an existing one).
3.  The command is written to the PTY.
4.  vloop waits for the prompt to return (or a timeout).
5.  The captured stdout/stderr is returned to the agent.
