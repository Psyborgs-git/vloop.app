# PRD: Core Daemon & WebSocket Layer (FS-1)

| Field | Value |
|---|---|
| **Status** | Draft |
| **Date** | 2026-02-22 |
| **Feature Set** | FS-1: Core Daemon & Networking |
| **Dependencies** | None (foundation layer) |

---

## 1. Problem Statement

The Orchestrator System requires a resilient, self-healing background daemon that serves as the transport and dispatch layer for all client interactions. Without this foundation, no other feature set can operate.

## 2. Goals

1. Run as a system daemon on Linux (systemd), macOS (launchd), and Windows (Windows Service).
2. Accept concurrent WebSocket connections over TLS 1.3.
3. Route messages to feature handlers via a topic/action addressing scheme.
4. Expose health and readiness endpoints for monitoring.
5. Provide structured, configurable logging with optional trace export.
6. Load configuration from TOML files with environment variable overrides.

## 3. Non-Goals

- Authentication/authorization logic (FS-2).
- Business logic for containers, processes, etc. (FS-3+).
- Horizontal scaling or clustering (future).

---

## 4. Functional Requirements

### FR-1: Daemonization

| ID | Requirement |
|---|---|
| FR-1.1 | Fork to background, write PID to configurable path, drop privileges to a non-root user. |
| FR-1.2 | Handle `SIGTERM` → graceful shutdown (drain connections, flush state, exit 0). |
| FR-1.3 | Handle `SIGHUP` → reload configuration without restart. |
| FR-1.4 | Handle `SIGINT` → identical to SIGTERM (for interactive debugging). |
| FR-1.5 | Provide `--foreground` flag to skip daemonization (for systemd `Type=simple`). |
| FR-1.6 | Detect and abort if another instance is already running (PID file lock). |

### FR-2: WebSocket Server

| ID | Requirement |
|---|---|
| FR-2.1 | Listen on a configurable address and port (default `0.0.0.0:9443`). |
| FR-2.2 | Enforce TLS 1.3 using Node.js built-in `tls` module. Support configurable cert/key paths. |
| FR-2.3 | Accept WebSocket upgrade requests. Negotiate subprotocol (`json` or `msgpack`). |
| FR-2.4 | Support text frames (JSON) and binary frames (MessagePack) based on negotiated subprotocol. |
| FR-2.5 | Enforce configurable max connections limit. Return `503` when exceeded. |
| FR-2.6 | Implement per-connection backpressure: if the send buffer exceeds a configurable threshold, drop non-critical messages and log a warning. |
| FR-2.7 | Send WebSocket `Ping` frames at configurable intervals. Close connections that fail to `Pong` within timeout. |

### FR-3: Message Protocol

All messages follow a standardised envelope:

```typescript
/** Inbound message from client */
interface Request {
  id: string;            // Client-generated correlation ID (UUIDv7)
  topic: string;         // Feature domain (e.g., "container", "process", "agent")
  action: string;        // Operation (e.g., "create", "list", "stop")
  payload: unknown;      // Action-specific data (JSON or MessagePack)
  meta: RequestMeta;     // Session ID, timestamp, trace ID
}

/** Outbound message to client */
interface Response {
  id: string;            // Echoed correlation ID
  type: ResponseType;    // "result" | "error" | "stream" | "event"
  topic: string;
  action: string;
  payload: unknown;
  meta: ResponseMeta;    // Timestamp, trace ID, sequence (for streams)
}

type ResponseType =
  | 'result'    // Final response to a request
  | 'error'     // Error response
  | 'stream'    // One frame in a streaming response (seq: number)
  | 'event';    // Unsolicited server-push event
```

| ID | Requirement |
|---|---|
| FR-3.1 | Parse inbound frames according to the negotiated subprotocol. Reject malformed frames with an `Error` response. |
| FR-3.2 | Validate that `topic` and `action` map to a registered handler. Return `UNKNOWN_TOPIC` or `UNKNOWN_ACTION` error codes. |
| FR-3.3 | Enforce a maximum message size (configurable, default 1 MiB). |
| FR-3.4 | Support streaming responses: multiple `Stream` frames with the same `id` and incrementing `seq`, terminated by a `Result` frame. |

### FR-4: Message Router

| ID | Requirement |
|---|---|
| FR-4.1 | Maintain a registry of topic handlers. Handlers register at daemon startup. |
| FR-4.2 | Dispatch messages to the matching handler based on `topic`. Pass `action` and `payload` to the handler. |
| FR-4.3 | Support middleware pipeline: each message passes through ordered middleware (logging, auth, rate-limit) before reaching the handler. |
| FR-4.4 | Handler responses are sent back to the originating connection using the correlation `id`. |
| FR-4.5 | If a handler throws, catch the error, log it, and return an `INTERNAL_ERROR` response without crashing the daemon. |

### FR-5: Health & Readiness Endpoints

| ID | Requirement |
|---|---|
| FR-5.1 | Serve HTTP `GET /healthz` returning `200 OK` with subsystem status JSON. |
| FR-5.2 | Serve HTTP `GET /readyz` returning `200 OK` only when all critical subsystems are ready, `503` otherwise. |
| FR-5.3 | Health endpoint runs on a separate port (configurable, default `9444`) to avoid TLS client-cert requirements. |

### FR-6: Structured Logging

| ID | Requirement |
|---|---|
| FR-6.1 | Emit structured JSON logs to stdout/stderr (for systemd journal capture). |
| FR-6.2 | Support log levels: `trace`, `debug`, `info`, `warn`, `error`. Configurable at startup and via `SIGHUP`. |
| FR-6.3 | Include `timestamp`, `level`, `module`, `message`, `trace_id`, `session_id` fields in each log line. |
| FR-6.4 | Optionally export spans to an OpenTelemetry collector (configurable endpoint). |

### FR-7: Configuration

| ID | Requirement |
|---|---|
| FR-7.1 | Load config from a TOML file at a configurable path (default `/etc/orchestrator/config.toml`). |
| FR-7.2 | Override any config value via environment variable (`ORCH_<SECTION>_<KEY>`). |
| FR-7.3 | Validate config at startup. Abort with descriptive error if config is invalid. |
| FR-7.4 | Support hot-reload of mutable config values (log level, max connections) via `SIGHUP`. |

---

## 5. Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Daemon starts, writes PID file, drops privileges, and accepts WebSocket connections over TLS 1.3. |
| AC-2 | A client can connect, send a JSON `Request` envelope, and receive a `Response` envelope. |
| AC-3 | Sending a message to an unregistered topic returns `UNKNOWN_TOPIC` error. |
| AC-4 | `SIGTERM` triggers graceful shutdown: in-flight requests complete, PID file removed, exit 0. |
| AC-5 | `/healthz` returns `200` with subsystem status. `/readyz` returns `503` during startup, `200` after. |
| AC-6 | Config validation rejects invalid TOML and prints a helpful error message. |
| AC-7 | MessagePack subprotocol negotiation works end-to-end. |
