# ADR-001: Technology Stack Selection (Revised)

| Field | Value |
|---|---|
| **Status** | Approved (Revised) |
| **Date** | 2026-02-22 |
| **Revision** | 2 — Pivoted from Rust to TypeScript/Node.js per stakeholder direction |
| **Decision Makers** | Engineering Lead, Project Stakeholders |
| **Scope** | Entire Orchestrator System |

---

## 1. Context

We are building a host-level background daemon that must:

- Run 24/7 as a resilient background service.
- Handle concurrent WebSocket connections with low latency.
- Interface with containerd (gRPC), host OS processes, and filesystem encryption.
- Support AI agent orchestration via Google's Agent Development Kit (`@google/adk`).
- Run cross-platform: **macOS, Linux, and Windows/WSL2**.
- Use **encrypted SQLite** (password-protected, not an open `.db` file).

Stakeholder directive: use **TypeScript** and **Node.js** as the primary language and runtime.

---

## 2. Decision

### Primary Language & Runtime: **TypeScript on Node.js**

| Criterion | TypeScript/Node.js | Rust | Go |
|---|---|---|---|
| **Developer Velocity** | ✅ Fastest iteration | ❌ Slower compile cycle | ⚠️ Good |
| **@google/adk Support** | ✅ Native TypeScript SDK | ❌ No SDK | ❌ No SDK |
| **Cross-Platform** | ✅ Runs everywhere Node.js runs | ⚠️ Cross-compile needed | ✅ Cross-compile |
| **Type Safety** | ✅ Static types + runtime flexibility | ✅ Compile-time | ⚠️ Limited generics |
| **Concurrency** | ✅ Event loop + worker threads | ✅ Tokio | ✅ Goroutines |
| **NPM Ecosystem** | ✅ Massive | ⚠️ Growing | ⚠️ Moderate |
| **containerd gRPC** | ✅ @grpc/grpc-js | ✅ tonic | ✅ Native |
| **Encrypted SQLite** | ✅ better-sqlite3-multiple-ciphers | ✅ rusqlite + sqlcipher | ⚠️ go-sqlcipher |

**Rationale**: TypeScript/Node.js is the optimal choice given the `@google/adk` requirement (native TS SDK), cross-platform support, and team alignment. The event-loop model is well-suited for I/O-heavy WebSocket workloads. `better-sqlite3-multiple-ciphers` provides AES-256 encrypted SQLite with password protection.

---

### Core Dependencies

#### Runtime & Build

| Component | Package | Purpose |
|---|---|---|
| **Runtime** | Node.js 22 LTS | Long-term support, native ESM, built-in test runner |
| **Build** | `tsx` + `tsup` | Dev-time execution + production bundling |
| **Type System** | TypeScript 5.x (strict mode) | End-to-end type safety |
| **Package Manager** | `pnpm` | Fast, disk-efficient, workspace support |

#### WebSocket & Networking

| Component | Package | Purpose |
|---|---|---|
| **WebSocket Server** | `ws` | RFC 6455 compliant, production-grade, per-message compression |
| **TLS** | Node.js `tls` module | Built-in TLS 1.3 support |
| **HTTP (Health)** | `fastify` | Lightweight HTTP for `/healthz`, `/readyz` endpoints |
| **Serialization** | `@msgpack/msgpack` | Binary MessagePack for high-throughput frames |

#### Authentication & Security

| Component | Package | Purpose |
|---|---|---|
| **JWT** | `jose` | JOSE/JWT/JWS/JWE (RS256, ES256, EdDSA). Modern, zero-dep. |
| **Argon2** | `argon2` | Password-based key derivation for vault |
| **AES-256-GCM** | Node.js `crypto` | Built-in authenticated encryption |
| **CSPRNG** | Node.js `crypto.randomBytes` | Cryptographically secure random generation |

#### Database

| Component | Package | Purpose |
|---|---|---|
| **Encrypted SQLite** | `better-sqlite3-multiple-ciphers` | SQLCipher-compatible, AES-256 encrypted `.db` files |

> [!IMPORTANT]
> The database file is **unreadable without the passphrase**. Encryption is applied at the page level using SQLCipher's `PRAGMA key`. This satisfies the requirement that the `.db` file is not an open, unprotected file.

```typescript
import Database from 'better-sqlite3-multiple-ciphers';

const db = new Database('/var/lib/orchestrator/state.db');
db.pragma(`key='${passphrase}'`);  // AES-256 encryption
db.pragma('journal_mode = WAL');    // Write-ahead logging
```

#### containerd Integration

| Component | Package | Purpose |
|---|---|---|
| **gRPC Client** | `@grpc/grpc-js` | Pure-JS gRPC (no native deps) |
| **Protobuf** | `@grpc/proto-loader` or `protobufjs` | Load containerd `.proto` definitions |

#### AI Agent Orchestration

| Component | Package | Purpose |
|---|---|---|
| **Agent Framework** | `@google/adk` | Agent lifecycle, tools, multi-agent orchestration |
| **Dev Tools** | `@google/adk-devtools` | Agent debugging and prototyping UI |

#### Process & Daemon Management

| Component | Package | Purpose |
|---|---|---|
| **Process Spawning** | Node.js `child_process` | Cross-platform process management |
| **Cron Scheduling** | `croner` | Lightweight, zero-dep cron with persistence support |
| **Signal Handling** | Node.js `process.on('SIGTERM')` | Graceful shutdown |
| **Cross-Platform Service** | `node-windows` / `node-mac` / `node-linux` | Register as OS service (systemd/launchd/Windows Service) |

#### Configuration

| Component | Package | Purpose |
|---|---|---|
| **TOML Parsing** | `smol-toml` | Fast, spec-compliant TOML parser |
| **Env Overrides** | Custom (`ORCH_` prefix) | Environment variable config override layer |
| **Validation** | `zod` | Runtime config schema validation with TypeScript inference |

#### Logging & Observability

| Component | Package | Purpose |
|---|---|---|
| **Structured Logging** | `pino` | High-performance JSON structured logging |
| **OpenTelemetry** | `@opentelemetry/sdk-node` | Optional trace/metric export |

---

### Cross-Platform Strategy

| Platform | Daemon Mode | Notes |
|---|---|---|
| **Linux** | systemd service | `orchestrator.service` unit file |
| **macOS** | launchd agent | `com.vloop.orchestrator.plist` |
| **Windows** | Windows Service via `node-windows` | Or run under WSL2 as a systemd service |
| **WSL2** | systemd service (same as Linux) | Native Linux binary under WSL2 |

All file paths use `path.join()` / `path.resolve()` with platform-aware defaults:

```typescript
const defaults = {
  configPath: process.platform === 'win32'
    ? path.join(process.env.PROGRAMDATA!, 'orchestrator', 'config.toml')
    : '/etc/orchestrator/config.toml',
  dataDir: process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA!, 'orchestrator')
    : '/var/lib/orchestrator',
};
```

---

### Testing Strategy

| Level | Tool | Scope |
|---|---|---|
| **Unit** | `vitest` | All modules, mocked dependencies |
| **Integration** | `vitest` + test fixtures | Real encrypted SQLite, real WebSocket |
| **E2E** | Custom harness | Full daemon lifecycle |
| **Security** | `npm audit`, `socket.dev` | Dependency CVE scanning |

---

## 3. Consequences

### Positive
- **Native `@google/adk` integration** — first-class AI agent SDK.
- **Cross-platform by default** — Node.js runs everywhere.
- **Encrypted SQLite** — `better-sqlite3-multiple-ciphers` provides page-level AES-256 encryption.
- **Fast iteration** — TypeScript + `tsx` enables rapid development.
- **Massive ecosystem** — npm has packages for every integration point.

### Negative
- **Single-threaded event loop** — CPU-intensive ops must use worker threads. Mitigated by offloading crypto ops to worker pool.
- **No compile-time memory safety** — Mitigated by strict TypeScript, ESLint rules, and runtime validation via `zod`.
- **Larger deployment footprint** — Requires Node.js runtime (vs. single static binary). Mitigated by bundling with `tsup` + `pkg` if needed.

### Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Event loop blocking on crypto | Use `crypto.subtle` (async) or worker threads for heavy KDF (Argon2) |
| `better-sqlite3` native addon compilation | Pre-built binaries available; CI builds for all target platforms |
| containerd proto compatibility | Pin proto versions, generate types at build time |

---

## 4. Decision Summary

| Component | Selected Technology |
|---|---|
| **Language** | TypeScript 5.x (strict mode) |
| **Runtime** | Node.js 22 LTS |
| **Package Manager** | pnpm |
| **WebSocket** | ws |
| **HTTP** | fastify (health endpoints) |
| **gRPC / containerd** | @grpc/grpc-js + proto-loader |
| **Database** | better-sqlite3-multiple-ciphers (AES-256 encrypted) |
| **AI Agents** | @google/adk |
| **JWT** | jose |
| **Crypto** | Node.js crypto (AES-GCM) + argon2 |
| **Config** | TOML (smol-toml) + zod validation |
| **Logging** | pino |
| **Testing** | vitest |
| **Daemon** | node-mac / node-linux / node-windows |
