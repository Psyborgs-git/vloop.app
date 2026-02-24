# WebSocket Subprotocol Guide

The Orchestrator defines a strict WebSocket topology for Inter-Process Communication (IPC) that is built to seamlessly exchange asynchronous data between the Web UI, independent Services and the Daemon.

## 1. SubProtocol Negotiation

The Orchestrator Daemon requires its connected clients to announce exactly how they intend to format their data packets. You must supply one of the following during the WebSocket handshake initialization:
- `msgpack`: The preferred underlying transport. Exchanges binary sequences constructed via `@msgpack/msgpack`.
- `json`: Unencoded ASCII payloads exchanged natively over the line.

**Note**: A missing SubProtocol string will implicitly default to `json` via the Orchestrator router. A mismatch in subprotocols guarantees a `MALFORMED_MESSAGE` connection drop (e.g., indicating `json` during initialization, but transmitting a `Uint8Array`).

### Example (Node.js)
```typescript
const ws = new WebSocket('wss://localhost:9443', ['msgpack']);
// After connection, send an auth.login message
```

### Example (Browser `isomorphic-ws`)
```typescript
const ws = new WebSocket(`wss://localhost:9443`, ['msgpack']);
// After connection, send an auth.login message
```


## 2. Request Envelope Structure

All payload events MUST be enclosed inside the core orchestration envelope. Both JSON and MsgPack topologies mandate this structure.

### Request Payload (`Request` object)
Initiates an execution pipeline in the daemon.
```typescript
{
    "id": "uuid-v4",
    "topic": "process",  // Daemon Namespace Route (e.g. process, agent, vault)
    "action": "list",    // Specific command within Namespace
    "payload": {},       // Schema-validated argument body
    "meta": {
        "timestamp": "ISO-8601",
        "trace_id": "optional-telemetry"
    }
}
```
*Note: The `session_id` is no longer required in the `meta` object. It is automatically tracked by the server per-connection after a successful `auth.login` message.*

### Response Payload (`Response` object)
Returned to specific single-event triggers.
```typescript
{
    "id": "uuid-v4",     // Matches the dispatching request ID
    "type": "response",  // Explicit type identifying the closing event
    "topic": "process",
    "action": "list",
    "payload": [...],    // The expected return value from the invoked action
    "meta": { ... }
}
```


### 3. Asynchronous Steaming
For commands expected to yield vast continuous data streams (such as AI generation output, process logs, etc.), the Orchestrator will emit objects with `"type": "stream"` progressively before sealing the connection.
```typescript
{
    "id": "uuid-v4",
    "type": "stream",  // Stream event token
    "topic": "agent",
    "action": "chat",
    "payload": {
        "text": "The latest generated token."
    },
    "meta": { "seq": 15 /* Delivery ordering integer */ }
}
```


## 4. Error Emittance
Any invalid schema requests, or underlying daemon failures will return a strict `error` variant instead of rejecting the socket directly. Use this parameter block for dynamic toast rendering.
```typescript
{
    "id": "uuid-v4",
    "type": "error",
    "topic": "vault",
    "action": "get",
    "payload": {
        "code": "ITEM_NOT_FOUND",
        "message": "The Vault was unable to load requested document.",
        "details": {}
    },
    "meta": { ... }
}
```

## 5. Terminal Topic (`terminal.*`)

The terminal subsystem streams PTY output in real time over the same request ID used for `terminal.spawn`.

### Spawn request

```typescript
{
    "id": "uuid-v4",
    "topic": "terminal",
    "action": "spawn",
    "payload": {
        "sessionId": "term_123",
        "shell": "/bin/zsh",
        "cwd": "/Users/me",
        "cols": 120,
        "rows": 30
    },
    "meta": { "timestamp": "ISO-8601" }
}
```

### Stream chunks

- PTY output chunk:

```typescript
{
    "id": "uuid-v4",
    "type": "stream",
    "topic": "terminal",
    "action": "spawn",
    "payload": { "sessionId": "term_123", "data": "ls -la\r\n" }
}
```

- PTY exit event (also streamed):

```typescript
{
    "id": "uuid-v4",
    "type": "stream",
    "topic": "terminal",
    "action": "spawn",
    "payload": { "sessionId": "term_123", "type": "exit", "exitCode": 0 }
}
```

For full terminal action coverage (`write`, `resize`, `kill`, `scrollback`, profile actions), see [`docs/terminal.md`](terminal.md).

## Additional Constraints
- Do not transmit raw JSON strings for Keepalives `{"type": "ping"}`; these are explicitly intercepted, however sending other custom root properties alongside valid schema blocks is invalid.
- Avoid large sequential payloads breaching the configured `network.max_message_size_bytes` constraints inside the daemon config.
