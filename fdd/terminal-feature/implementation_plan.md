# Fix Container Service + Implement Cross-Platform Terminal Feature

The container service fails to detect Docker on macOS because the socket path detection uses CJS [require()](file:///Users/jainamshah/Desktop/vloop.app/packages/container/src/handler.ts#147-158) in an ESM project. After fixing this, we'll implement a full terminal/shell feature with `node-pty` backend and `xterm.js` frontend, including permissions, profiles, and session logging.

## User Review Required

> [!IMPORTANT]
> **`node-pty` is a native addon** — it requires a C++ build toolchain (`node-gyp`). It should already work on macOS with Xcode CLT installed, but may add build complexity for CI.

> [!WARNING]
> **Terminal access is a security-sensitive feature.** The implementation will include:
> - Role-based access (only `admin` and `operator` roles can spawn terminals)
> - Command allowlist/blocklist middleware
> - Session-level isolation (each terminal session is tied to a user identity)

---

## Proposed Changes

### Container Fix — Docker Socket Detection

#### [MODIFY] [docker.ts](file:///Users/jainamshah/Desktop/vloop.app/packages/container/src/docker.ts)

Replace [detectSocketPathSync()](file:///Users/jainamshah/Desktop/vloop.app/packages/container/src/docker.ts#122-146) function to use `import('node:fs')` synchronous import (top-level) instead of CJS [require()](file:///Users/jainamshah/Desktop/vloop.app/packages/container/src/handler.ts#147-158). Add support for all macOS Docker Desktop socket paths:

```diff
+import { existsSync } from 'node:fs';
+
 function detectSocketPathSync(): string {
     if (process.platform === 'win32') {
         return '//./pipe/docker_engine';
     }
 
     const home = process.env['HOME'] ?? '';
-    const homeSocket = `${home}/.docker/run/docker.sock`;
-    const defaultSocket = '/var/run/docker.sock';
-
-    try {
-         
-        const fs = require('node:fs') as typeof import('node:fs');
-        if (fs.existsSync(homeSocket)) {
-            return homeSocket;
-        }
-    } catch {
-        // Fall through
-    }
-
-    return defaultSocket;
+    const candidates = [
+        `${home}/.docker/run/docker.sock`,
+        `${home}/.docker/desktop/docker.sock`,
+        '/var/run/docker.sock',
+    ];
+
+    for (const sock of candidates) {
+        if (existsSync(sock)) return sock;
+    }
+
+    return '/var/run/docker.sock'; // last-resort default
 }
```

**Root cause:** The project uses `"type": "module"` (ESM), so [require('node:fs')](file:///Users/jainamshah/Desktop/vloop.app/packages/container/src/handler.ts#147-158) throws an error, the `catch` swallows it silently, and [detectSocketPathSync()](file:///Users/jainamshah/Desktop/vloop.app/packages/container/src/docker.ts#122-146) always returns `/var/run/docker.sock` — which doesn't exist on macOS Docker Desktop.

---

### New Package: `@orch/terminal`

#### [NEW] [package.json](file:///Users/jainamshah/Desktop/vloop.app/packages/terminal/package.json)

New workspace package with dependencies: `node-pty`, `@orch/shared`, `@orch/daemon`.

---

#### [NEW] [manager.ts](file:///Users/jainamshah/Desktop/vloop.app/packages/terminal/src/manager.ts)

Core `TerminalManager` class:

- **`spawn(sessionId, options)`** — Creates a PTY process via `node-pty`. Options include `shell`, `cwd`, `env`, `cols`, [rows](file:///Users/jainamshah/Desktop/vloop.app/packages/ai-agent/src/tools/browser.ts#6-109). Returns a `TerminalSession` object.
- **`write(sessionId, data)`** — Sends input to a PTY session.
- **`resize(sessionId, cols, rows)`** — Resizes a PTY.
- **`kill(sessionId)`** — Kills a PTY session and cleans up.
- **`listSessions()`** — Lists active terminal sessions with metadata.
- **Session events** — Emits [data](file:///Users/jainamshah/Desktop/vloop.app/packages/orchestrator/data), `exit` events per session via EventEmitter.
- **Auto-detect shell** — `zsh` on macOS, `bash` on Linux, `powershell.exe` on Windows.

---

#### [NEW] [permissions.ts](file:///Users/jainamshah/Desktop/vloop.app/packages/terminal/src/permissions.ts)

Permission system:

- **`TerminalPolicy`** — Defines allowed roles, command blocklist patterns (regex), max concurrent sessions per identity.
- **`checkAccess(identity, roles, policy)`** — Returns whether a user can spawn/use terminals.
- **`validateCommand(shell, policy)`** — Checks if a shell is in the allowlist.
- Default policy: only `admin` and `operator` roles, blocks dangerous shells, max 5 concurrent sessions.

---

#### [NEW] [profiles.ts](file:///Users/jainamshah/Desktop/vloop.app/packages/terminal/src/profiles.ts)

Terminal profile management:

- **`TerminalProfileManager`** — CRUD for terminal profiles stored in the orchestrator DB.
- Each profile has: [id](file:///Users/jainamshah/Desktop/vloop.app/packages/web-ui/src/App.tsx#51-172), `name`, `shell`, `cwd`, `env`, `startupCommands`, `owner`.
- Methods: [create()](file:///Users/jainamshah/Desktop/vloop.app/packages/container/src/handler.ts#14-144), [get()](file:///Users/jainamshah/Desktop/vloop.app/packages/ai-agent/src/tools.ts#24-27), [list()](file:///Users/jainamshah/Desktop/vloop.app/packages/ai-agent/src/tools.ts#28-31), [update()](file:///Users/jainamshah/Desktop/vloop.app/packages/web-ui/src/views/ConsoleView.tsx#244-253), `delete()`, `getDefault()`.

---

#### [NEW] [logger.ts](file:///Users/jainamshah/Desktop/vloop.app/packages/terminal/src/logger.ts)

Session log streaming and persistence:

- **`SessionLogger`** — Captures all PTY output to a ring buffer + file.
- **`startRecording(sessionId)`** — Begins writing to `data/terminal-logs/<sessionId>.log`.
- **`getScrollback(sessionId, lines?)`** — Returns last N lines from buffer.
- **`exportSession(sessionId)`** — Exports full session to file.
- Configurable max scrollback size and log rotation.

---

#### [NEW] [handler.ts](file:///Users/jainamshah/Desktop/vloop.app/packages/terminal/src/handler.ts)

WebSocket topic handler factory `createTerminalHandler()`:

| Action | Description |
|--------|-------------|
| `spawn` | Create a new terminal session |
| `write` | Send input to a session |
| `resize` | Resize terminal dimensions |
| `kill` | Terminate a session |
| [list](file:///Users/jainamshah/Desktop/vloop.app/packages/ai-agent/src/tools.ts#28-31) | List active sessions |
| `scrollback` | Get session scrollback buffer |
| `profile.list` | List terminal profiles |
| `profile.create` | Create a terminal profile |
| `profile.update` | Update a terminal profile |
| `profile.delete` | Delete a terminal profile |

Streaming: The `spawn` action uses `context.emit('stream', data)` to push PTY output to the client in real-time.

---

#### [NEW] [index.ts](file:///Users/jainamshah/Desktop/vloop.app/packages/terminal/src/index.ts)

Public API surface — exports all classes and types.

---

### Orchestrator Integration

#### [MODIFY] [main.ts](file:///Users/jainamshah/Desktop/vloop.app/packages/orchestrator/src/main.ts)

- Import `@orch/terminal` components
- Instantiate `TerminalManager`, `TerminalProfileManager`, `SessionLogger`
- Register `terminal` topic handler
- Register `terminal_execute` tool in [ToolRegistry](file:///Users/jainamshah/Desktop/vloop.app/packages/ai-agent/src/tools.ts#11-32) for AI agent use
- Add terminal health subsystem
- Cleanup terminal sessions on shutdown

#### [MODIFY] [package.json](file:///Users/jainamshah/Desktop/vloop.app/packages/orchestrator/package.json)

Add `"@orch/terminal": "workspace:*"` to dependencies.

---

### Frontend — xterm.js Terminal View

#### [MODIFY] [package.json](file:///Users/jainamshah/Desktop/vloop.app/packages/web-ui/package.json)

Add dependencies:
- `@xterm/xterm` (xterm v5+)
- `@xterm/addon-fit`
- `@xterm/addon-web-links`

#### [NEW] [TerminalView.tsx](file:///Users/jainamshah/Desktop/vloop.app/packages/web-ui/src/views/TerminalView.tsx)

Full-featured terminal view:
- **xterm.js terminal** rendering in a container div
- **Session tabs** — create/switch/close multiple terminal tabs
- **Profile selector** — dropdown to pick a terminal profile
- **Toolbar** — kill, resize, clear, export controls
- **Real-time streaming** via `client.requestStream('terminal', 'spawn', ...)`
- **Input handling** — captures keystrokes and sends via `client.request('terminal', 'write', ...)`
- **Responsive** — Uses `FitAddon` to auto-resize with container

#### [MODIFY] [App.tsx](file:///Users/jainamshah/Desktop/vloop.app/packages/web-ui/src/App.tsx)

- Import `TerminalView`
- Add `{ path: '/terminal', label: 'Terminal', icon: SquareTerminal }` to sidebar links
- Add `<Route path="/terminal" element={<TerminalView />} />`

#### [MODIFY] [serviceRegistry.ts](file:///Users/jainamshah/Desktop/vloop.app/packages/web-ui/src/serviceRegistry.ts)

Add `terminal` topic with all actions for Console view.

---

### Client Namespace

#### [NEW] [terminal.ts](file:///Users/jainamshah/Desktop/vloop.app/packages/client/src/namespaces/terminal.ts)

Typed namespace for terminal operations:
- `spawn(options)`, `write(sessionId, data)`, `resize(sessionId, cols, rows)`, `kill(sessionId)`, [list()](file:///Users/jainamshah/Desktop/vloop.app/packages/ai-agent/src/tools.ts#28-31)

#### [MODIFY] [index.ts](file:///Users/jainamshah/Desktop/vloop.app/packages/client/src/index.ts)

Add `export * from './namespaces/terminal.js';`

---

### Documentation

#### [NEW] [terminal.md](file:///Users/jainamshah/Desktop/vloop.app/docs/terminal.md)

Comprehensive documentation covering:
- Architecture overview with Mermaid diagram
- Permission model and RBAC
- Profile management
- Session lifecycle
- AI tool integration
- WebSocket protocol for terminal actions
- Frontend usage
- Security considerations

---

## Verification Plan

### Automated Tests

1. **Existing Docker test** — confirms container service fix:
   ```bash
   cd /Users/jainamshah/Desktop/vloop.app && npx vitest run packages/container/src/docker.test.ts
   ```

2. **New terminal tests** — `packages/terminal/src/manager.test.ts`:
   ```bash
   cd /Users/jainamshah/Desktop/vloop.app && npx vitest run packages/terminal/src/manager.test.ts
   ```

3. **TypeScript compilation** — no type errors:
   ```bash
   cd /Users/jainamshah/Desktop/vloop.app && npx tsc --build packages/terminal packages/orchestrator --noEmit
   ```

### Manual Verification

1. **Container fix**: Restart orchestrator with `pnpm run dev` and verify the log NO LONGER shows `"Docker is not available — container monitoring disabled"`. Instead it should show `"Container monitor started"`.

2. **Terminal UI**: Open `http://localhost:5173/terminal` in the browser, verify:
   - A terminal session spawns with the default shell
   - Typing commands produces output
   - Session tabs work (open multiple, switch between them)
   - Kill button terminates the session
