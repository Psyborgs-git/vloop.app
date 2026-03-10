# WASM Host-Function Bridge Reference

Plugins communicate with the host process through a set of exported host
functions wired by `PluginSandbox`.  All functions use
[Extism](https://extism.org/) call-context memory for parameter and return
passing — strings are serialised to/from UTF-8, structured data to JSON.

---

## Logging

Namespace: `extism:host/user`

| Function | Signature (WASM side) | Description |
|---|---|---|
| `log_info` | `(msgPtr: i64) → void` | Write an info-level log line via the plugin's child logger |
| `log_error` | `(msgPtr: i64) → void` | Write an error-level log line |

---

## Contract discovery

| Function | Signature | Description |
|---|---|---|
| `host_get_contract` | `() → i64` | Returns a JSON-encoded `PluginTaskHostContract` describing every available host function and the plugin's permissions. Plugins should call this once on startup. |

---

## Database access (`db:read` / `db:write`)

| Function | Signature | Description |
|---|---|---|
| `db_query` | `(sqlPtr: i64, paramsPtr: i64) → i64` | Execute a parameterised SQL statement against the plugin's private SQLite database. `paramsPtr` is a JSON array of `SqlParam` values. Returns a JSON array of row objects on success, or `{"error":"…"}` on failure. |

> **Security**: Each plugin receives its own AES-256-XTS encrypted SQLite
> database provisioned by `@orch/db-manager`.  No cross-plugin data access is
> possible.  Write operations require the `db:write` permission in addition to
> `db:read`.

---

## Vault access (`vault:read` / `vault:write`)

| Function | Signature | Description |
|---|---|---|
| `vault_read` | `(keyPtr: i64) → i64` | Read a secret by key. Returns the raw value string, or an empty string if the key does not exist. Returns `{"error":"…"}` on permission denial or other failure. |
| `vault_write` | `(keyPtr: i64, valuePtr: i64) → i64` | Create or update a secret. Returns `{"ok":true}` on success. |

Permission required: `vault:read:<key>` or `vault:read:*` / `vault:write:<key>` or `vault:write:*`.

---

## Events (`events:subscribe` / `events:publish`)

| Function | Signature | Description |
|---|---|---|
| `events_subscribe` | `(topicPtr: i64) → i64` | Subscribe to a `HooksEventBus` topic. Incoming events are delivered by calling the plugin's `on_event` export with a JSON payload `{ topic, payload }`. Returns `{"ok":true}` or `{"error":"…"}`. |
| `events_publish` | `(topicPtr: i64, payloadPtr: i64) → i64` | Publish a JSON payload to a topic. Plugins may only publish to their own namespace `plugin.<id>.*`. Returns `{"ok":true}` or `{"error":"…"}`. |

Required permissions: `events:subscribe` / `events:subscribe:<topic>` and `events:publish`.

### `on_event` export (plugin side)

```ts
// AssemblyScript example
export function on_event(inputPtr: i32): i32 {
  const json = input_string();  // { topic: string; payload: string }
  // handle event …
  return 0;
}
```

---

## Task domain operations (requires `task` in manifest)

These host functions route structured requests through the `HooksEventBus`
using the `PluginTaskEnvelope` format and return `QueuedPluginTaskResponse`.
The response is always fire-and-forget: `{ ok: true, queued: true, topic }`.

### `contacts_manage` (`contacts:read` / `contacts:write`)

Payload: JSON-encoded `ContactRequest`

```ts
// upsert
{ operation: 'upsert'; contact: PluginScopedContact }
// remove
{ operation: 'remove'; contactId: string }
// list
{ operation: 'list'; search?: string; limit?: number }
```

### `chat_manage` (`chat:read` / `chat:write`)

Payload: JSON-encoded `ChatRequest`

```ts
// send
{ operation: 'send'; conversationId: string; recipientId?: string; message: string; metadata?: Record<string,unknown> }
// list
{ operation: 'list'; conversationId?: string; limit?: number }
// archive
{ operation: 'archive'; conversationId: string }
```

### `agent_infer` (`agent:run`)

Payload: JSON-encoded `AgentInferenceRequest`

```ts
{
  prompt: string;
  conversationId?: string;
  model?: string;
  mode?: 'reply' | 'plan' | 'tool';  // default: 'reply'
  metadata?: Record<string, unknown>;
}
```

### `notifications_notify` (`notifications:publish`)

Payload: JSON-encoded `NotificationRequest`

```ts
{
  title?: string;
  message: string;
  channel?: 'event' | 'toast' | 'email' | 'webhook';  // default: 'event'
  topic?: string;   // custom suffix under plugin.<id>.* namespace
  metadata?: Record<string, unknown>;
}
```

---

## AssemblyScript `env.abort` stub

AssemblyScript WASM modules import `env.abort` for fatal runtime errors.
`PluginSandbox` provides a no-op stub that logs at `error` level with source
line/column so panics are visible in structured logs without crashing the host.
