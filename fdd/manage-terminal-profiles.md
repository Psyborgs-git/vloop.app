# Feature Specification: Manage the terminal profile of a system

## 1. Feature Metadata & FDD Naming
* **Feature Statement:** Manage the terminal profile of a system
* **Feature Set / Subject Area:** Terminal Access and Security (`@orch/terminal`)
* **Priority & Target Release:** High / P0 (Core Operations & Security)

## 2. Business Context & Value (The "Why")
Providing browser-based, secure terminal access (PTY) to the orchestrator environment is essential for administration and debugging. However, unrestricted shell access is a massive security risk. This feature implements strict profiles that dictate which shell (`bash`, `sh`, `zsh`) can run, which users (RBAC) can spawn them, and critically, a robust pattern-matching engine (allowlist/blocklist) that sanitizes input commands before execution.

## 3. File Manifest & Architecture Impact (The "Where")
* **Files:**
  * `packages/terminal/src/permissions.js`: Core input validation, regex caching, and shell executable checks.
  * `packages/terminal/src/manager.js`: Spawns and tracks PTY sessions using `node-pty`.
  * `packages/terminal/src/store.js`: Persists terminal profiles securely.
  * `packages/terminal/src/handler.js`: HTTP API and WebSocket data stream integration.
* **Dependencies:** `node-pty`, `@orch/shared` (pagination, errors), `better-sqlite3-multiple-ciphers` (configured for in-memory testing).

## 4. Design by Feature (The "How")
* **Domain Object Model Impact:** A new `terminal_profiles` schema linking `{ name, shell, allowed_roles, input_allow_patterns, input_block_patterns }`.
* **Sequence of Operations:**
  1. User/Agent requests a new terminal session specifying a profile ID.
  2. `TerminalProfileManager` checks RBAC via `checkAccess` (validating the requester's role against `allowed_roles`).
  3. `validateShell` confirms the requested executable is permitted (e.g., preventing `/bin/sh` if only `/bin/bash` is allowed).
  4. The PTY is spawned and a WebSocket stream is established.
  5. As the user types, `validateInput` intercepts the keystrokes/commands, normalizes whitespace, and checks against the cached regex patterns (`inputAllowPatterns` / `inputBlockPatterns`).
  6. The sanitized input is forwarded to the PTY.
* **Edge Cases & Error Handling:**
  * Malicious Input/Regex Denial of Service (ReDoS): Blocked via strict regex caching and timeout mechanisms in `validateInput`.
  * Unauthorized Shell: Instantly rejected with a `PERMISSION_REQUIRED` error.
  * Disconnected WebSockets: Automatically terminate the corresponding underlying PTY process to prevent resource leaks.

## 5. Large-Scale / OSS Methodology Guidelines
* **Backward Compatibility:** All new terminal profiles must default to strict lock-down (e.g., allowlist `[]`, blocklist `.*`) unless explicitly overridden.
* **Feature Flagging:** PTY features can be entirely disabled in immutable environments (e.g., read-only production clusters).
* **Security & Performance:** `validateInput` utilizes whitespace normalization to prevent evasion (e.g., `rm     -rf` vs `rm -rf`). The regex cache ensures rapid evaluation of every keystroke without blocking the Node.js event loop.

## 6. Testing & Acceptance Criteria (Build by Feature)
* **Unit Test Requirements:** Must directly instantiate `better-sqlite3-multiple-ciphers` for in-memory tests (bypassing `DatabaseManager` constraints). Must thoroughly test whitespace normalization in `permissions.ts`.
* **Integration Test Requirements:** Spin up a simulated PTY, inject a valid command, verify output, inject an invalid command (e.g., `rm -rf /`), and verify execution is blocked.
* **Reviewer Checklist:**
  * [ ] Are terminal regex patterns cached correctly?
  * [ ] Does whitespace normalization prevent evasion techniques?
  * [ ] Are PTY processes strictly killed when the client disconnects?
