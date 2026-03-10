# Permission Model

## Overview

Permissions follow a capability format: `<domain>:<action>[:<resource>]`.  They
are declared in `plugin.json` and granted by an admin at install time.  The
granted set is stored in `PluginRecord.granted_permissions` and enforced at
every host-function call site.

---

## Permission table

| Permission | Host function(s) | Description |
|---|---|---|
| `settings:read` | `settings_get` | Read keys from the plugin's settings store |
| `fs:read` | `wasi:fd_read` | Read files within the plugin's isolated `/data` directory |
| `settings:write` | `settings_set`, `settings_delete` | Write or delete keys in the settings store |
| `fs:write` | `wasi:fd_write` | Write files within the plugin's isolated `/data` directory |
| `vault:read:<key>` | `vault_read` | Read a specific vault secret |
| `vault:read:*` | `vault_read` | Read any vault secret |
| `vault:write:<key>` | `vault_write` | Create/update a specific vault secret |
| `vault:write:*` | `vault_write` | Create/update any vault secret |
| `contacts:read` | `contacts_manage` (list) | List contacts |
| `contacts:write` | `contacts_manage` (upsert/remove) | Upsert or remove contacts |
| `contacts:*` | `contacts_manage` (any) | Full contacts access |
| `chat:read` | `chat_manage` (list) | List conversations/messages |
| `chat:write` | `chat_manage` (send/archive) | Send messages or archive conversations |
| `chat:*` | `chat_manage` (any) | Full chat access |
| `agent:run` | `agent_infer` | Submit prompts to the AI agent |
| `agent:*` | `agent_infer` | (alias) |
| `notifications:publish` | `notifications_notify` | Publish notifications |
| `notifications:*` | `notifications_notify` | (alias) |
| `events:subscribe` | `events_subscribe` | Subscribe to any event topic |
| `events:subscribe:<topic>` | `events_subscribe` | Subscribe to a specific topic |
| `events:publish` | `events_publish` | Publish events to `plugin.<id>.*` namespace |
| `network:outbound` | _(reserved)_ | Future: allow outbound HTTP requests |

---

## Grant flow

```
1. Caller → PluginManager.prepareInstall(url)
            Returns PluginManifest with .permissions[] (declared by author)

2. Caller reviews manifest.permissions and decides which to grant.

3. Caller → PluginManager.commitInstall(id, grantedPermissions)
            Stores grantedPermissions in the DB.
            Plugin is only given the granted subset — it cannot
            escalate beyond what was granted even if it declared more.
```

> **Principle of least privilege**: Only grant the permissions your workflow
> actually needs.  Bundled extensions (auto-installed from `./extensions/`) are
> granted all permissions they declare.

---

## Event namespace enforcement

When a plugin publishes events via `events_publish`, the host enforces that the
topic starts with `plugin.<pluginId>.`.  This prevents cross-plugin spoofing
through the event bus.

```
✓  plugin.telegram-chat.message.received
✗  system.auth.token.issued          ← rejected with PERMISSION_DENIED
```

---

## Vault key scoping

When a plugin calls `vault_read` or `vault_write`, the host checks:

```
vault:<action>:<key>   exact match
vault:<action>:*       wildcard match
```

There is no prefix-glob support beyond `*` — make sure each key name you
intend to be accessible is covered by one of the granted permission strings.
