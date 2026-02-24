# Task: Fix Container Service + Implement Terminal Feature

## Phase 1: Fix Container Service Docker Detection
- [x] Fix [detectSocketPathSync()](file:///Users/jainamshah/Desktop/vloop.app/packages/container/src/docker.ts#123-145) in [packages/container/src/docker.ts](file:///Users/jainamshah/Desktop/vloop.app/packages/container/src/docker.ts) — use ESM `import` instead of CJS [require()](file:///Users/jainamshah/Desktop/vloop.app/packages/container/src/handler.ts#147-158)
- [x] Add additional macOS Docker Desktop socket paths (`~/.docker/desktop/docker.sock`)
- [ ] Verify container service starts with Docker available

## Phase 2: Create `@orch/terminal` Package (Backend)
- [x] Create `packages/terminal/` package structure with [package.json](file:///Users/jainamshah/Desktop/vloop.app/package.json), [tsconfig.json](file:///Users/jainamshah/Desktop/vloop.app/tsconfig.json)
- [x] Install `node-pty` dependency
- [x] Implement `TerminalManager` — session lifecycle, spawn/kill/resize PTY sessions
- [x] Implement permission/privilege controls — command allowlist/blocklist, role-based access
- [x] Implement profile management — shell profiles with env/cwd/shell per user
- [x] Implement session log streaming and persistence — save scrollback to disk
- [x] Implement `TerminalHandler` — WebSocket topic handler for `terminal.*` actions
- [x] Write unit tests for terminal manager

## Phase 3: Wire Into Orchestrator
- [x] Add `@orch/terminal` as dependency of `@orch/orchestrator`
- [x] Register `terminal` topic handler in [main.ts](file:///Users/jainamshah/Desktop/vloop.app/packages/orchestrator/src/main.ts)
- [x] Register `terminal` AI tool in [ToolRegistry](file:///Users/jainamshah/Desktop/vloop.app/packages/ai-agent/src/tools.ts#11-32)
- [x] Add terminal health subsystem registration

## Phase 4: Frontend — xterm.js Terminal View
- [x] Install `xterm` + `@xterm/addon-fit` + `@xterm/addon-web-links` in `web-ui`
- [x] Create `TerminalView.tsx` — full xterm.js terminal UI with session tabs, profile selector
- [x] Add Terminal route to [App.tsx](file:///Users/jainamshah/Desktop/vloop.app/packages/web-ui/src/App.tsx) sidebar navigation
- [x] Add `terminal` topic to [serviceRegistry.ts](file:///Users/jainamshah/Desktop/vloop.app/packages/web-ui/src/serviceRegistry.ts) for Console

## Phase 5: Add to Client Namespace
- [x] Create `packages/client/src/namespaces/terminal.ts`
- [x] Export from client index

## Phase 6: Documentation
- [x] Write comprehensive `docs/terminal.md`
- [ ] Update existing docs references

## Phase 7: Verification
- [x] Run existing docker test to verify container fix
- [x] Run terminal unit tests
- [ ] Restart orchestrator and verify no Docker warning
- [ ] Manual UI verification of terminal view
