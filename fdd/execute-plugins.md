# Feature Specification: Execute the wasm module of a plugin

## 1. Feature Metadata & FDD Naming
* **Feature Statement:** Execute the wasm module of a plugin
* **Feature Set / Subject Area:** Plugin Manager (`@orch/plugin-manager`)
* **Priority & Target Release:** High / P0 (Extensibility Platform)

## 2. Business Context & Value (The "Why")
Providing an extensible orchestration system requires secure, isolated, and highly performant execution of third-party or custom logic. WebAssembly (WASM), powered by Extism, delivers a sandboxed, multi-language execution environment. This capability guarantees that untrusted plugins cannot harm the host system, while still allowing them to interact securely via tightly controlled, synchronous host functions (e.g., database queries, vault access, event dispatching).

## 3. File Manifest & Architecture Impact (The "Where")
* **Files:**
  * `packages/plugin-manager/src/manager.js`: Core plugin lifecycle orchestration.
  * `packages/plugin-manager/src/store.js`: Database abstraction for plugin metadata tracking.
  * `packages/plugin-manager/src/manifest.js`: Validation of the `plugin.json` schema and permission requirements.
  * `packages/plugin-manager/src/handler.js`: Handles API requests for plugin loading, execution, and removal.
* **Dependencies:** `@extism/extism`, `@orch/db-manager`, `@orch/shared` (permissions, validation).

## 4. Design by Feature (The "How")
* **Domain Object Model Impact:** `plugins` database schema tracking `{ id, name, version, status, source_path, permissions }`.
* **Sequence of Operations:**
  1. User/Agent uploads or points to a `.wasm` plugin package containing a `plugin.json` manifest.
  2. `PluginManager` recursively copies the plugin files to the target storage path.
  3. The `Manifest` is parsed and strict granular permissions (`vault:read:<key>`, `hook:read:<topic>`) are validated.
  4. The plugin is instantiated via Extism in a strictly sandboxed environment.
  5. The host provides synchronous functions (e.g., `querySync`) for the WASM module to call back into the Orchestrator safely.
  6. On uninstallation, the manager recursively deletes the files (`rm -rf`) and then removes the database record.
* **Edge Cases & Error Handling:**
  * Manifest Validation Failure: Returns a 400 Bad Request with a strict schema validation error.
  * Extism Memory/Timeout Errors: Safely caught, logged, and isolated to prevent host crashes.
  * Unauthorized Host Function Calls: Emits a `PERMISSION_REQUIRED` exception inside the sandbox and terminates the invocation.

## 5. Large-Scale / OSS Methodology Guidelines
* **Backward Compatibility:** Must ensure old manifest schemas can be gracefully upgraded or supported. Host function signatures cannot be fundamentally altered without breaking existing WASM modules.
* **Feature Flagging:** Plugin execution can be disabled globally via `ORCH_DISABLE_PLUGINS`. Specific host functions can be individually disabled or rate-limited.
* **Security & Performance:** Host functions *must* be synchronous due to Extism SDK constraints. All disk operations (removal) must complete successfully before database transaction commits to prevent orphaned files.

## 6. Testing & Acceptance Criteria (Build by Feature)
* **Unit Test Requirements:** Must mock the filesystem interactions when verifying the `force: true` deletion logic. Must verify the offline Vitest aliases (`vitest.config.ts`) map correctly to `@orch/daemon` source files.
* **Integration Test Requirements:** Load a valid WASM module, execute a function that requests a synchronous database query, and verify the correct host function response is handled inside the sandbox.
* **Reviewer Checklist:**
  * [ ] Are all provided host functions strictly synchronous?
  * [ ] Are file deletion actions robust against disk I/O errors prior to DB commit?
  * [ ] Are Extism sandbox memory limits configured securely?
