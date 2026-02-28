# Feature Specification: Manage the identities of a system

## 1. Feature Metadata & FDD Naming
* **Feature Statement:** Manage the identities of a system
* **Feature Set / Subject Area:** Authentication, Authorization, Session Management, and Audit (`@orch/auth`)
* **Priority & Target Release:** High / P0 (Core Platform)

## 2. Business Context & Value (The "Why")
Authentication and authorization are foundational elements of the Orchestrator system. Securely managing user identities allows administrators to enforce precise access control (RBAC), track user activity (Auditing), and secure API endpoints and WebSocket channels (JWT & Session management). In an OSS environment, a robust and extensible auth layer guarantees safe multi-tenant operation, ensuring that contributors and users can safely expose internal services without risking unauthorized access.

## 3. File Manifest & Architecture Impact (The "Where")
* **Files:**
  * `packages/auth/src/jwt.js`: Token validation and issuance logic.
  * `packages/auth/src/session.js`: Stateful session management across WebSockets.
  * `packages/auth/src/rbac.js`: Policy Engine for fine-grained permissions.
  * `packages/auth/src/audit.js`: Structured logging for sensitive operations.
  * `packages/auth/src/middleware.js`: Express HTTP middleware.
  * `packages/auth/src/user.js`: User entity and database interaction logic.
  * `packages/auth/src/jwt-provider.js`: Provider interface and persistence for external IDPs.
* **Dependencies:** `better-sqlite3-multiple-ciphers` (via `@orch/db-manager`), `@orch/shared` (pagination, errors), Express.

## 4. Design by Feature (The "How")
* **Domain Object Model Impact:** Introduces the `users`, `sessions`, `audit_logs`, and `jwt_providers` schemas. `users` table uses indexes on `created_at DESC` to optimize paginated list queries.
* **Sequence of Operations:**
  1. User authenticates via credentials or external IDP.
  2. The `JwtProviderManager` validates external signatures if necessary.
  3. `JwtValidator` verifies the internal token signature and expiry.
  4. `SessionManager` registers the connection state.
  5. On any authenticated action, `PolicyEngine` (RBAC) verifies access.
  6. If critical, `AuditLogger` records the event to the DB asynchronously.
* **Edge Cases & Error Handling:**
  * Invalid/expired JWT: Return 401 Unauthorized immediately.
  * Missing Permissions: Return 403 Forbidden via `PERMISSION_REQUIRED` error (defined in `@orch/shared`).
  * Circular dependency prevention: Event buses decouple authentication from underlying infrastructure logging.

## 5. Large-Scale / OSS Methodology Guidelines
* **Backward Compatibility:** Database schema updates must be additive. If changing token claims, the `JwtValidator` must support grace periods for legacy claims formats.
* **Feature Flagging:** Specific RBAC features can be disabled via configuration variables. External JWT Providers can be enabled/disabled per instance.
* **Security & Performance:** The `users` and `jwt_providers` database schemas MUST include indexes on `created_at DESC` for optimized `ORDER BY ... LIMIT ... OFFSET` pagination. High velocity endpoints MUST cache RBAC policies in memory (avoiding N+1 DB lookups). The `PolicyEngine.load` must utilize `fs.promises` to be fully non-blocking.

## 6. Testing & Acceptance Criteria (Build by Feature)
* **Unit Test Requirements:** `JwtValidator` MUST mock `JwtProviderManager` to avoid runtime compilation errors with `better-sqlite3-multiple-ciphers`. `users.list` must test standardized pagination return objects (`{ items, total }`).
* **Integration Test Requirements:** Test the full middleware pipeline passing valid and invalid JWTs. Verify AuditLogger writes to an isolated integration database.
* **Reviewer Checklist:**
  * [ ] Are DB operations safe from SQL Injection?
  * [ ] Do pagination endpoints conform to `@orch/shared` interface?
  * [ ] Does the `JwtValidator` correctly test against mocked providers?
  * [ ] Are file operations in `PolicyEngine` asynchronous?
