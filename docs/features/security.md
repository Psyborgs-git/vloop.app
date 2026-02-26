# Core Security

vloop is built around a zero-trust architecture where every action—whether from a human or an AI agent—must be authenticated, authorized, and audited.

## 1. Authentication

All requests to the vloop daemon must include a valid JSON Web Token (JWT). The system supports multiple identity providers (IdP) and can also act as its own issuer.

*   **Session Management**: Sessions are persisted in an encrypted SQLite database.
*   **Token Types**: Currently supports Bearer tokens issued by the `auth` subsystem.
*   **Idle Timeout**: Sessions automatically expire after a configurable period (default: 1 hour).

## 2. Authorization (RBAC)

Access control is enforced by a robust Role-Based Access Control (RBAC) engine. Permissions are defined in `config/policies.toml` and evaluated at runtime for every single request.

### Policy Structure

Policies follow a `topic:action:resource` format.

```toml
# Example: Read-only viewer role
[roles.viewer]
permissions = [
  "process:list:*",
  "container:list:*",
  "logs:read:*"
]

# Example: AI Agent with specific tool access
[roles.agent_dev]
permissions = [
  "terminal:execute:workspace-1",
  "git:clone:*"
]
```

When an agent attempts to use a tool, the request is intercepted and checked against these policies. If the agent lacks the necessary permission (e.g., trying to `rm -rf /` without `fs:write:root` access), the action is blocked and logged.

## 3. The Vault (Secrets Management)

vloop includes a built-in secrets vault to securely manage API keys, database credentials, and other sensitive data.

*   **Encryption**: All secrets are encrypted at rest using **AES-256-GCM**.
*   **Key Derivation**: The encryption key is derived from a master passphrase using **Argon2id**.
*   **Zeroization**: Sensitive memory buffers are zeroed out after use to prevent memory scraping attacks.

### Usage

**Storing a Secret**:
```bash
orch vault put api_keys/openai sk-proj-...
```

**Injecting a Secret**:
When configuring an agent or process, reference the secret path instead of the value:
```yaml
env:
  OPENAI_API_KEY: "vault:api_keys/openai"
```
The value is decrypted and injected into the process environment *only* at runtime.

## 4. Audit Logging

Every mutation (create, update, delete, execute) is recorded in an immutable audit log. This provides a complete trail of:
*   **Who**: The user or agent identity.
*   **What**: The specific action and resource.
*   **When**: Timestamp with millisecond precision.
*   **Outcome**: Whether the action was allowed or denied.
*   **Context**: Request ID and session ID for tracing.

Audit logs are stored in the encrypted database and can be queried by administrators for compliance or debugging.
