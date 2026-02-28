# Feature Specification: Store the encrypted secrets of a user

## 1. Feature Metadata & FDD Naming
* **Feature Statement:** Store the encrypted secrets of a user
* **Feature Set / Subject Area:** Secret Management (`@orch/vault`)
* **Priority & Target Release:** High / P0 (Core Security Platform)

## 2. Business Context & Value (The "Why")
Modern distributed orchestrators require a secure medium to manage configuration variables, API keys, and connection strings. By building an internal, encrypted vault using robust ciphers, developers and plugins can safely run within the environment without exposing credentials. This removes the dependency on heavy external tools (like HashiCorp Vault) while providing a developer-friendly API.

## 3. File Manifest & Architecture Impact (The "Where")
* **Files:**
  * `packages/vault/src/crypto.js`: Core AES-GCM encryption/decryption routines.
  * `packages/vault/src/store.js`: SQLite storage layer (`VaultStore`).
  * `packages/vault/src/handler.js`: HTTP/WS request handling for secret management.
  * `packages/vault/src/inject.js`: Utility to inject decrypted secrets into process environments (`SecretInjector`).
* **Dependencies:** `better-sqlite3-multiple-ciphers` (for SQLite layer encryption).

## 4. Design by Feature (The "How")
* **Domain Object Model Impact:** A new `vault_secrets` schema containing `key`, `encrypted_value`, `owner_id`, and `created_at`.
* **Sequence of Operations:**
  1. User/System submits a key-value pair.
  2. `VaultCrypto` generates a unique IV and encrypts the value using a master key derived from environment variables (`ORCH_VAULT_PASSPHRASE`).
  3. `VaultStore` stores the `{ key, iv, ciphertext, owner_id }`.
  4. Upon retrieval, the requester’s identity is validated against the `owner_id` (or `admin` role).
  5. If authorized, `VaultCrypto` decrypts and returns the plaintext.
* **Edge Cases & Error Handling:**
  * Bad Passphrase/Decryption Failure: Yields a detailed crypto error (but DO NOT leak the master key in logs).
  * Unauthorized Access: Returns `PERMISSION_REQUIRED` if the user is neither the owner nor an admin.
  * Missing Key: Returns 404 Not Found.

## 5. Large-Scale / OSS Methodology Guidelines
* **Backward Compatibility:** Must support migrating old cipher formats if the master key or encryption algorithm changes.
* **Feature Flagging:** Vault is fundamentally required; however, its persistence mechanism could be toggled (e.g., in-memory vs. disk for testing).
* **Security & Performance:** The Vault operates strictly synchronously with `better-sqlite3-multiple-ciphers`. Extensive memory management guarantees that plaintext secrets are explicitly cleared or garbage collected. Secrets owned by `__system__` are strictly isolated from normal users unless they possess the `admin` role.

## 6. Testing & Acceptance Criteria (Build by Feature)
* **Unit Test Requirements:** Must mock database connections in tests that do not involve disk writes. Direct `better-sqlite3-multiple-ciphers` instantiation must be used when in-memory databases (`:memory:`) are tested.
* **Integration Test Requirements:** Test full CRUD lifecycle: store -> retrieve -> verify decryption matches original plaintext.
* **Reviewer Checklist:**
  * [ ] Are plaintext values ever logged? (They must not be).
  * [ ] Does the `VaultStore` enforce strict ACLs against `__system__` secrets?
  * [ ] Are unit tests configured correctly for SQLite in-memory constraints?
