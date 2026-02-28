# Feature Specification: Dispatch the system event to a subscriber

## 1. Feature Metadata & FDD Naming
* **Feature Statement:** Dispatch the system event to a subscriber
* **Feature Set / Subject Area:** Core Routing and Eventing (`@orch/daemon` and `@orch/orchestrator`)
* **Priority & Target Release:** High / P0 (Core Infrastructure)

## 2. Business Context & Value (The "Why")
As an orchestrator coordinating multiple distinct domains (containers, agents, authentication, processes, terminal PTYs), asynchronous message passing is critical. A robust, bidirectional system event bus over WebSockets ensures low-latency updates (like streaming container logs or broadcasting AI tool calls) without tightly coupling internal packages. This central nervous system enables seamless extensibility for OSS contributors and deterministic testing.

## 3. File Manifest & Architecture Impact (The "Where")
* **Files:**
  * `packages/daemon/src/router.js`: Core WebSocket message parsing and dispatch.
  * `packages/daemon/src/server.js`: Web server configuration (HTTP/WS).
  * `packages/orchestrator/src/bridge.js`: Connects disparate package events (e.g., Docker) to the `HooksEventBus`.
  * `packages/shared/src/hooks-bus.js`: Generic Pub/Sub and event schema.
* **Dependencies:** `ws`, `pino` (logging), `@orch/shared` (pagination, errors), Express.

## 4. Design by Feature (The "How")
* **Domain Object Model Impact:** No persistent state beyond active WS connections, which are memory-bound. `hooks-bus.js` implements a decoupled local `Logger` interface to prevent dependency cycles.
* **Sequence of Operations:**
  1. Client establishes WS connection.
  2. Router receives a structured `{ topic: 'container', action: 'create', payload: {...} }` frame.
  3. The handler extracts `topic` and dispatches `action` (e.g., "create", *not* "container.create").
  4. Concurrently, internal systems (like `ContainerMonitor`) emit raw native events.
  5. `SystemEventBridge` (in the orchestrator composition root) translates native events to generic `topic:action` messages.
  6. The `HooksEventBus` broadcasts to subscribed WS clients or AI agent workflows.
* **Edge Cases & Error Handling:**
  * Malformed JSON: Gracefully log and close connection with standard error code.
  * Router Dispatch Failure: Catch `Error` and return a standard `OrchestratorError` schema.
  * Circular Dependency Risks: Enforce that `SystemEventBridge` resides in the composition root (`@orch/orchestrator`) rather than `@orch/daemon`.

## 5. Large-Scale / OSS Methodology Guidelines
* **Backward Compatibility:** All existing `action` schemas MUST be strictly versioned or additive. Changing the schema breaks any consumer of that event topic.
* **Feature Flagging:** Specific event topics can be firewalled at the router level via RBAC.
* **Security & Performance:** The router passes `action` as an un-prefixed string. High message volume streams (like logs) must be rate-limited or chunked to prevent memory exhaustion of the WebSocket buffer.

## 6. Testing & Acceptance Criteria (Build by Feature)
* **Unit Test Requirements:** Must mock WS streams and simulate heavy message load. Verify the router properly strips the topic prefix when passing the action.
* **Integration Test Requirements:** Start the OrchestratorApp, establish a WS connection, dispatch a mock container start event, and verify the client receives the translated hook payload.
* **Reviewer Checklist:**
  * [ ] Does the routing logic separate `topic` and `action` strings correctly?
  * [ ] Are the log interfaces cleanly abstracted in `@orch/shared`?
  * [ ] Is `SystemEventBridge` correctly placed in the `@orch/orchestrator` package?
