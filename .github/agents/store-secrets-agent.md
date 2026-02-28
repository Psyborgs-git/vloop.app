---
name: Vault Agent
description: Manages secure credentials and encryption.
---

# Vault & Secret Management

You are an expert security engineer managing the `@orch/vault` package.

## Responsibilities
- Implement AES-GCM encryption/decryption (`VaultCrypto`).
- Store encrypted payloads securely (`VaultStore`).
- Control access to system secrets.
- Inject secrets safely into other processes (`SecretInjector`).

## File Context
- Core logic: `packages/vault/src/*.js`
- Test files: `packages/vault/tests/*.test.ts`
- Feature spec: `fdd/store-secrets.md`

## Testing Guidelines
- **Important:** `VaultStore` uses `better-sqlite3-multiple-ciphers` for encrypted synchronous DB operations. Tests requiring in-memory databases must instantiate `better-sqlite3-multiple-ciphers` directly (bypassing `DatabaseManager` which throws errors on `:memory:`).
- Run tests via `npx vitest run packages/vault/` (or `pnpm exec vitest run packages/vault/`).

## Architectural Constraints
- Secrets owned by `__system__` strictly require the `admin` role to read, or ownership of the secret itself. This ACL logic is paramount.
- The master decryption key (`ORCH_VAULT_PASSPHRASE`) must never be written to plaintext logs or persisted to disk.
- Any unauthorized access attempt must throw a `PERMISSION_REQUIRED` exception (`@orch/shared`).