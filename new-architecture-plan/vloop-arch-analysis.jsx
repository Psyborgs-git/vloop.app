import { useState } from "react";

const sections = [
  {
    id: "current",
    label: "Current Architecture",
    icon: "⚠",
  },
  {
    id: "shortfalls",
    label: "Architectural Shortfalls",
    icon: "✗",
  },
  {
    id: "target",
    label: "Target Architecture",
    icon: "◈",
  },
  {
    id: "layers",
    label: "Layer Breakdown",
    icon: "≡",
  },
  {
    id: "events",
    label: "Event Bus Design",
    icon: "⟳",
  },
  {
    id: "rbac",
    label: "RBAC & Gateway",
    icon: "⬡",
  },
  {
    id: "migration",
    label: "Migration Path",
    icon: "→",
  },
];

const shortfalls = [
  {
    severity: "CRITICAL",
    area: "No API Gateway",
    detail:
      "All services are co-located in a single pnpm monorepo with no dedicated gateway process. There is no single ingress point handling auth, rate-limiting, or routing. `certs/` sitting at the repo root means TLS termination is baked into the app layer — not the gateway.",
    fix: "Introduce a standalone gateway package (`packages/gateway`) that owns TLS termination, JWT validation, and service routing before any request reaches a downstream service.",
  },
  {
    severity: "CRITICAL",
    area: "No RBAC Layer",
    detail:
      "No visible identity, permission, or policy model. Services like terminal, AI, filesystem, and vault are equally reachable by any process in the monorepo — access control is either absent or scattered ad-hoc.",
    fix: "Centralise RBAC in a dedicated `packages/rbac` module with a policy engine (e.g. CASL or a custom permissions graph). Every service call must carry a signed capability token validated by the gateway.",
  },
  {
    severity: "CRITICAL",
    area: "No Event Bus / Message Queue",
    detail:
      "The current structure implies direct function calls between packages. WebSocket connections are likely handled in-process with no durability. If the server crashes, all in-flight requests vanish.",
    fix: "Introduce Redis as the backbone: one channel per service type (terminal:commands, ai:requests, fs:ops, vault:ops). Gateway publishes events; each service worker subscribes only to its own channel.",
  },
  {
    severity: "HIGH",
    area: "Monolithic Coupling via pnpm Workspace",
    detail:
      "pnpm workspaces create local symlinks between packages — they share a single node_modules and can import each other freely. This means a bug or crash in one package can cascade. There is no process isolation.",
    fix: "Keep pnpm workspaces for the build toolchain, but run each logical service as a separate Node.js process (or container) that communicates only through Redis, not through direct imports.",
  },
  {
    severity: "HIGH",
    area: "Extensions In-Tree",
    detail:
      "`extensions/` is committed inside the main repo. If extensions can interact with services (terminal, vault), they inherit the same trust level as core code — a compromised extension can access everything.",
    fix: "Move extensions to a separate sandboxed runtime. Extensions should be loaded dynamically and communicate with the gateway via a restricted event contract, not direct service access.",
  },
  {
    severity: "HIGH",
    area: "Certs at Root Level",
    detail:
      "`certs/` at the monorepo root means TLS secrets are co-located with application code. This is a credential hygiene issue and couples certificate rotation with deployments.",
    fix: "Remove certs from the repo entirely. Inject via environment secrets at the gateway only. Use a cert manager (Caddy, cert-manager, or similar) in front of the gateway process.",
  },
  {
    severity: "HIGH",
    area: "Data Layer Not Isolated",
    detail:
      "`data/` at the root suggests filesystem-level storage directly accessible by any package. There is no abstraction layer, no access logging, and no encryption boundary.",
    fix: "Create a dedicated `vault-service` that exclusively owns persistent storage. All other services must request data through the vault's event channel, not by touching the filesystem directly.",
  },
  {
    severity: "MEDIUM",
    area: "No Service Discovery",
    detail:
      "Services find each other via import paths (monorepo coupling), not via a registry. Adding or removing a service requires touching code in other packages.",
    fix: "Services register themselves at startup in Redis (HSET service:registry). The gateway reads the registry to route events dynamically — services become plug-and-play.",
  },
  {
    severity: "MEDIUM",
    area: "WebSocket Sessions Not Externalised",
    detail:
      "If WebSocket state is held in-process, horizontal scaling is impossible — two gateway instances can't share session state.",
    fix: "Store WebSocket session metadata in Redis (`ws:sessions:{connectionId}`). Any gateway replica can look up session context and fan out events to the right subscriber.",
  },
  {
    severity: "MEDIUM",
    area: "No Observability Hooks",
    detail:
      "No visible structured logging, tracing, or metrics setup. In an event-driven system with multiple services, debugging requires end-to-end trace IDs.",
    fix: "Every event published to Redis must carry a `traceId`. Services emit structured logs with the trace context. Integrate with OpenTelemetry from day one.",
  },
];

const serviceNodes = [
  { id: "client", label: "Browser Client", sub: "React / WS", color: "#4ade80", x: 50, y: 8 },
  { id: "gateway", label: "API Gateway", sub: "Auth · RBAC · WS Hub", color: "#f59e0b", x: 50, y: 25 },
  { id: "redis", label: "Redis", sub: "Pub/Sub · Queue · Sessions", color: "#ef4444", x: 50, y: 44 },
  { id: "terminal", label: "Terminal Service", sub: "pty process", color: "#818cf8", x: 15, y: 65 },
  { id: "ai", label: "AI Service", sub: "LLM router", color: "#818cf8", x: 37, y: 65 },
  { id: "fs", label: "FS Service", sub: "file system ops", color: "#818cf8", x: 59, y: 65 },
  { id: "vault", label: "Vault Service", sub: "secrets & data", color: "#818cf8", x: 82, y: 65 },
  { id: "rbac", label: "RBAC Store", sub: "roles · policies", color: "#f472b6", x: 50, y: 83 },
];

const connections = [
  { from: "client", to: "gateway", label: "WSS / HTTPS" },
  { from: "gateway", to: "redis", label: "publish events" },
  { from: "redis", to: "terminal", label: "subscribe" },
  { from: "redis", to: "ai", label: "subscribe" },
  { from: "redis", to: "fs", label: "subscribe" },
  { from: "redis", to: "vault", label: "subscribe" },
  { from: "gateway", to: "rbac", label: "policy check" },
];

const eventSchema = [
  {
    channel: "gateway:inbound",
    direction: "Client → Gateway",
    example: `{
  "traceId": "tr_abc123",
  "sessionId": "ws_xyz",
  "service": "terminal",
  "action": "exec",
  "payload": { "cmd": "ls -la" }
}`,
    note: "Gateway validates JWT, checks RBAC, then re-emits to the correct service channel.",
  },
  {
    channel: "terminal:commands",
    direction: "Gateway → Terminal Service",
    example: `{
  "traceId": "tr_abc123",
  "userId": "u_42",
  "roles": ["developer"],
  "action": "exec",
  "payload": { "cmd": "ls -la" },
  "replyTo": "terminal:results:ws_xyz"
}`,
    note: "Service reads userId + roles but never calls back to gateway — only publishes to replyTo channel.",
  },
  {
    channel: "terminal:results:{sessionId}",
    direction: "Terminal Service → Gateway → Client",
    example: `{
  "traceId": "tr_abc123",
  "status": "ok",
  "stream": "stdout chunk...",
  "done": false
}`,
    note: "Gateway subscribes to per-session reply channels and forwards chunks over the client's WebSocket.",
  },
];

const rbacModel = [
  { role: "guest", permissions: ["ai:chat"], deny: ["terminal:*", "fs:write", "vault:*"] },
  { role: "developer", permissions: ["ai:*", "terminal:exec", "fs:read", "fs:write"], deny: ["vault:admin"] },
  { role: "admin", permissions: ["*"], deny: [] },
];

const migrationSteps = [
  {
    phase: "Phase 1",
    title: "Isolate the Gateway",
    duration: "~1 week",
    tasks: [
      "Create packages/gateway as a standalone Express + ws server",
      "Move certs out of repo, inject via env at gateway only",
      "All client connections must go through gateway — no direct service access",
      "Stub RBAC: static permission map per user role",
    ],
  },
  {
    phase: "Phase 2",
    title: "Introduce Redis Event Bus",
    duration: "~1–2 weeks",
    tasks: [
      "Add Redis (ioredis) to the project",
      "Define channel naming conventions: `{service}:{action}` and `{service}:results:{sessionId}`",
      "Port terminal service to subscribe to terminal:commands, publish to results channel",
      "Gateway publishes inbound WS messages as events; subscribes to per-session reply channels",
    ],
  },
  {
    phase: "Phase 3",
    title: "Migrate All Services",
    duration: "~2 weeks",
    tasks: [
      "Port AI service to event-driven (ai:requests → ai:results:{sessionId})",
      "Port filesystem service with write-ahead logging to Redis before disk ops",
      "Create vault-service as sole owner of data/ directory",
      "Remove all cross-package imports between services — only Redis channels remain",
    ],
  },
  {
    phase: "Phase 4",
    title: "Full RBAC + Service Registry",
    duration: "~1 week",
    tasks: [
      "Gateway publishes RBAC-enriched events (userId, roles on every event)",
      "Services read roles from event, apply their own capability checks",
      "Services register in Redis HSET service:registry on startup",
      "Build admin panel to manage roles, view active services, inspect event queues",
    ],
  },
  {
    phase: "Phase 5",
    title: "Extension Sandbox",
    duration: "~2 weeks",
    tasks: [
      "Move extensions/ to a separate repo / dynamic loader",
      "Extensions connect to gateway with a restricted JWT (role: extension:{id})",
      "Extension permissions defined per-extension in RBAC store",
      "Gateway audits all extension events — logged to Redis stream for replay",
    ],
  },
];

const severityColor = { CRITICAL: "#ef4444", HIGH: "#f97316", MEDIUM: "#eab308" };
const severityBg = { CRITICAL: "#1a0000", HIGH: "#1a0a00", MEDIUM: "#1a1400" };

export default function VloopArch() {
  const [active, setActive] = useState("current");
  const [expandedShortfall, setExpandedShortfall] = useState(null);

  return (
    <div style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", background: "#0a0a0f", color: "#c8c8d8", minHeight: "100vh", fontSize: 13 }}>
      {/* Header */}
      <div style={{ borderBottom: "1px solid #1e1e2e", padding: "20px 32px", display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444" }} />
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b" }} />
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80" }} />
        <span style={{ marginLeft: 12, color: "#6e6e8e", fontSize: 11 }}>vloop.app</span>
        <span style={{ color: "#3e3e5e", margin: "0 4px" }}>/</span>
        <span style={{ color: "#818cf8" }}>architecture-analysis.md</span>
      </div>

      {/* Nav */}
      <div style={{ display: "flex", borderBottom: "1px solid #1e1e2e", overflowX: "auto" }}>
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            style={{
              background: active === s.id ? "#1e1e2e" : "transparent",
              border: "none",
              borderBottom: active === s.id ? "2px solid #818cf8" : "2px solid transparent",
              color: active === s.id ? "#c8c8d8" : "#6e6e8e",
              padding: "12px 20px",
              cursor: "pointer",
              fontSize: 12,
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>{s.icon}</span> {s.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: "28px 32px", maxWidth: 960, margin: "0 auto" }}>

        {/* CURRENT ARCHITECTURE */}
        {active === "current" && (
          <div>
            <h2 style={{ color: "#818cf8", marginBottom: 4, fontSize: 16 }}>Current Architecture — What the Repo Reveals</h2>
            <p style={{ color: "#6e6e8e", marginBottom: 24, lineHeight: 1.7 }}>
              Inferred from the public repo structure: pnpm monorepo, TypeScript 99%, single root package.json,
              pnpm-workspace.yaml, certs at root, data at root, extensions in-tree, integration tests only.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {[
                { dir: "packages/", obs: "Monorepo packages — services share process, imports are direct, no isolation boundary." },
                { dir: "extensions/", obs: "In-tree extensions with same trust level as core. No sandboxing." },
                { dir: "certs/", obs: "TLS credentials committed alongside code. Rotation requires a deploy." },
                { dir: "data/", obs: "Raw data dir accessible to any package. No vault abstraction." },
                { dir: "config/", obs: "Shared config across all services. No per-service secret scope." },
                { dir: "fdd/", obs: "Feature-Driven Design docs — intent is there but not enforced by process isolation." },
                { dir: "scripts/", obs: "Likely glue scripts for starting services. No orchestrator or supervisor." },
                { dir: "tests/integration/", obs: "Integration tests exist — but if services share process, tests can't catch inter-service failures." },
              ].map((item) => (
                <div key={item.dir} style={{ background: "#0f0f1a", border: "1px solid #1e1e2e", borderRadius: 6, padding: 16 }}>
                  <div style={{ color: "#4ade80", marginBottom: 6, fontSize: 12 }}>{item.dir}</div>
                  <div style={{ color: "#9898b8", lineHeight: 1.6, fontSize: 12 }}>{item.obs}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 24, background: "#0f0f1a", border: "1px solid #1e1e2e", borderRadius: 6, padding: 20 }}>
              <div style={{ color: "#f59e0b", marginBottom: 10, fontSize: 12 }}>INFERRED RUNTIME TOPOLOGY</div>
              <pre style={{ color: "#c8c8d8", margin: 0, fontSize: 12, lineHeight: 1.8 }}>{`
  Browser
    │
    └─ [HTTPS/WSS] ──► Single Node.js process
                          ├── packages/gateway? (or just app entry)
                          ├── packages/terminal
                          ├── packages/ai
                          ├── packages/fs
                          └── packages/vault
                              │
                              └── data/ (direct fs access)

  ● No event bus
  ● No process separation  
  ● No RBAC enforcement point
  ● No session store
  ● Extensions: same runtime = full trust
`}</pre>
            </div>
          </div>
        )}

        {/* SHORTFALLS */}
        {active === "shortfalls" && (
          <div>
            <h2 style={{ color: "#818cf8", marginBottom: 4, fontSize: 16 }}>Architectural Shortfalls</h2>
            <p style={{ color: "#6e6e8e", marginBottom: 24, lineHeight: 1.7 }}>
              Ranked by severity. Click any card to see the fix.
            </p>
            {shortfalls.map((s, i) => (
              <div
                key={i}
                onClick={() => setExpandedShortfall(expandedShortfall === i ? null : i)}
                style={{
                  background: expandedShortfall === i ? severityBg[s.severity] : "#0f0f1a",
                  border: `1px solid ${expandedShortfall === i ? severityColor[s.severity] : "#1e1e2e"}`,
                  borderRadius: 6,
                  padding: 16,
                  marginBottom: 10,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{
                    background: severityColor[s.severity],
                    color: "#000",
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 3,
                  }}>{s.severity}</span>
                  <span style={{ color: "#c8c8d8", fontSize: 13 }}>{s.area}</span>
                  <span style={{ marginLeft: "auto", color: "#6e6e8e", fontSize: 12 }}>{expandedShortfall === i ? "▲" : "▼"}</span>
                </div>
                {expandedShortfall === i && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ color: "#9898b8", lineHeight: 1.7, marginBottom: 12 }}>{s.detail}</div>
                    <div style={{ background: "#0a1a0a", border: "1px solid #1e3e1e", borderRadius: 4, padding: 12 }}>
                      <div style={{ color: "#4ade80", fontSize: 11, marginBottom: 6 }}>FIX</div>
                      <div style={{ color: "#9898b8", lineHeight: 1.7 }}>{s.fix}</div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* TARGET ARCHITECTURE */}
        {active === "target" && (
          <div>
            <h2 style={{ color: "#818cf8", marginBottom: 4, fontSize: 16 }}>Target Architecture — Decoupled Event-Driven System</h2>
            <p style={{ color: "#6e6e8e", marginBottom: 24, lineHeight: 1.7 }}>
              Each service runs as an independent Node.js process. Redis is the only shared state. The gateway is the only process that touches the internet.
            </p>
            {/* ASCII Architecture Diagram */}
            <div style={{ background: "#0f0f1a", border: "1px solid #1e1e2e", borderRadius: 6, padding: 24, marginBottom: 20 }}>
              <pre style={{ color: "#c8c8d8", margin: 0, fontSize: 11.5, lineHeight: 2.0 }}>{`
  ┌────────────────────────────────────────────────┐
  │              BROWSER CLIENT                    │
  │   React App — WebSocket + REST over HTTPS      │
  └──────────────────┬─────────────────────────────┘
                     │ WSS / HTTPS (TLS terminates here)
  ┌──────────────────▼─────────────────────────────┐
  │              API GATEWAY (Node.js)             │
  │  ● JWT validation     ● Rate limiting          │
  │  ● RBAC policy check  ● Session registry       │
  │  ● WS connection hub  ● Request → Event        │
  │  ● Reply fan-out      ● Audit logging          │
  └──────────────────┬─────────────────────────────┘
                     │ publish / subscribe
  ┌──────────────────▼─────────────────────────────┐
  │              REDIS                             │
  │  Channels:  terminal:cmds  ai:requests         │
  │             fs:ops         vault:ops           │
  │  Sessions:  ws:sessions:{id}                  │
  │  Registry:  service:registry                   │
  │  Queues:    gateway:inbound  (persistent)      │
  └───┬────────────┬──────────┬──────────┬─────────┘
      │            │          │          │
  ┌───▼──┐    ┌───▼──┐   ┌───▼──┐   ┌───▼───┐
  │ TERM │    │  AI  │   │  FS  │   │ VAULT │
  │ svc  │    │  svc │   │  svc │   │  svc  │
  │ pty  │    │ LLM  │   │ files│   │secrets│
  └──────┘    └──────┘   └──────┘   └───────┘
      │            │          │          │
      └────────────┴──────────┴──────────┘
                publishes results back to Redis
              gateway forwards to client over WS

  ┌─────────────────────────────────────────────────┐
  │  RBAC STORE (Redis + optional Postgres)         │
  │  roles, permissions, capability tokens          │
  │  queried by gateway on every inbound request    │
  └─────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────┐
  │  EXTENSION RUNTIME (sandboxed process)          │
  │  Connects to gateway as role: extension:{id}    │
  │  Restricted JWT — limited channel access only   │
  └─────────────────────────────────────────────────┘
`}</pre>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {[
                { label: "Process Count (target)", value: "6+ independent Node.js processes" },
                { label: "Shared State", value: "Redis only — zero direct imports across services" },
                { label: "Auth Boundary", value: "Gateway enforces JWT + RBAC before any event is emitted" },
                { label: "WS Sessions", value: "Stored in Redis — gateway is stateless and horizontally scalable" },
                { label: "Service Discovery", value: "HSET service:registry — plug-and-play service registration" },
                { label: "Extensions", value: "Sandboxed process, restricted role, no direct service access" },
              ].map((item) => (
                <div key={item.label} style={{ background: "#0f0f1a", border: "1px solid #1e1e2e", borderRadius: 6, padding: 14 }}>
                  <div style={{ color: "#6e6e8e", fontSize: 11, marginBottom: 4 }}>{item.label}</div>
                  <div style={{ color: "#4ade80", fontSize: 12 }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* LAYER BREAKDOWN */}
        {active === "layers" && (
          <div>
            <h2 style={{ color: "#818cf8", marginBottom: 4, fontSize: 16 }}>Layer Breakdown — Package Structure</h2>
            <p style={{ color: "#6e6e8e", marginBottom: 24, lineHeight: 1.7 }}>
              Recommended monorepo layout — pnpm workspaces are fine for the build toolchain, but each package runs as its own process at runtime.
            </p>
            {[
              {
                pkg: "packages/gateway",
                runtime: "Node.js process · public-facing",
                color: "#f59e0b",
                deps: ["ioredis", "jsonwebtoken", "ws", "express"],
                responsibilities: [
                  "TLS termination (certs injected via env)",
                  "JWT verification on every connection",
                  "RBAC policy check — load role from rbac-store, validate capability",
                  "Translate inbound WS message → Redis event",
                  "Subscribe to per-session reply channels → fan-out over WS",
                  "Rate limiting, audit logging, tracing",
                ],
              },
              {
                pkg: "packages/rbac",
                runtime: "Shared library (imported by gateway only)",
                color: "#f472b6",
                deps: ["ioredis", "zod"],
                responsibilities: [
                  "Role definitions: guest / developer / admin / extension:{id}",
                  "Permission schema: {service}:{action} e.g. terminal:exec, vault:read",
                  "Policy engine: given (userId, roles, requestedAction) → allow | deny",
                  "Role store backed by Redis hash — hot-reloadable without restart",
                ],
              },
              {
                pkg: "packages/terminal-service",
                runtime: "Node.js process · internal-only",
                color: "#818cf8",
                deps: ["ioredis", "node-pty"],
                responsibilities: [
                  "Subscribes to terminal:commands channel",
                  "Spawns pty per session, scoped to userId sandbox",
                  "Streams output chunks back to terminal:results:{sessionId}",
                  "Enforces command allowlist based on roles in event payload",
                ],
              },
              {
                pkg: "packages/ai-service",
                runtime: "Node.js process · internal-only",
                color: "#818cf8",
                deps: ["ioredis", "openai / anthropic sdk"],
                responsibilities: [
                  "Subscribes to ai:requests",
                  "Routes to appropriate LLM based on user role/quota",
                  "Streams tokens back to ai:results:{sessionId}",
                  "Implements per-user rate limiting in Redis",
                ],
              },
              {
                pkg: "packages/fs-service",
                runtime: "Node.js process · internal-only",
                color: "#818cf8",
                deps: ["ioredis", "chokidar"],
                responsibilities: [
                  "Subscribes to fs:ops",
                  "Enforces path sandboxing per userId — no path traversal",
                  "All writes are logged to Redis stream before disk commit",
                  "Can emit file-change events back for live reload scenarios",
                ],
              },
              {
                pkg: "packages/vault-service",
                runtime: "Node.js process · internal-only",
                color: "#818cf8",
                deps: ["ioredis", "argon2", "crypto"],
                responsibilities: [
                  "The ONLY process that reads/writes data/ directory",
                  "Subscribes to vault:ops — all other services treat it as an API",
                  "Encrypts secrets at rest; decrypts only for authorized userId",
                  "Audit log of every access to Redis stream",
                ],
              },
              {
                pkg: "packages/event-contracts",
                runtime: "Shared library (build time only)",
                color: "#4ade80",
                deps: ["zod"],
                responsibilities: [
                  "TypeScript types for every event shape",
                  "Zod schemas for runtime validation",
                  "Channel name constants — single source of truth",
                  "Imported by gateway and all services for contract enforcement",
                ],
              },
            ].map((pkg) => (
              <div key={pkg.pkg} style={{ background: "#0f0f1a", border: `1px solid ${pkg.color}33`, borderRadius: 6, padding: 18, marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                  <span style={{ color: pkg.color, fontSize: 13 }}>{pkg.pkg}</span>
                  <span style={{ color: "#6e6e8e", fontSize: 11, marginLeft: "auto" }}>{pkg.runtime}</span>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                  {pkg.deps.map(d => (
                    <span key={d} style={{ background: "#1e1e2e", color: "#9898b8", fontSize: 10, padding: "2px 8px", borderRadius: 3 }}>{d}</span>
                  ))}
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {pkg.responsibilities.map((r, i) => (
                    <li key={i} style={{ color: "#9898b8", fontSize: 12, lineHeight: 1.8, display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <span style={{ color: pkg.color, marginTop: 2 }}>·</span> {r}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/* EVENT BUS DESIGN */}
        {active === "events" && (
          <div>
            <h2 style={{ color: "#818cf8", marginBottom: 4, fontSize: 16 }}>Event Bus Design — Redis Channels & Schemas</h2>
            <p style={{ color: "#6e6e8e", marginBottom: 24, lineHeight: 1.7 }}>
              Every interaction in the system is an event published to a Redis channel. The gateway is the only publisher of inbound events. Services are the only publishers of result events.
            </p>

            <div style={{ background: "#0f0f1a", border: "1px solid #1e1e2e", borderRadius: 6, padding: 18, marginBottom: 20 }}>
              <div style={{ color: "#f59e0b", fontSize: 11, marginBottom: 12 }}>CHANNEL NAMING CONVENTION</div>
              <pre style={{ color: "#c8c8d8", margin: 0, fontSize: 12, lineHeight: 1.8 }}>{`
  Inbound  :  gateway:inbound                    — all client → server events
  Commands :  {service}:{action}                 — e.g. terminal:commands, ai:requests
  Results  :  {service}:results:{sessionId}      — per-connection response streams
  Registry :  service:registry                   — HSET { serviceName: lastHeartbeat }
  Sessions :  ws:sessions:{connectionId}         — HSET { userId, roles, connectedAt }
  Audit    :  audit:stream                       — Redis Stream (XADD) for every event
  `}</pre>
            </div>

            {eventSchema.map((ev, i) => (
              <div key={i} style={{ background: "#0f0f1a", border: "1px solid #1e1e2e", borderRadius: 6, padding: 18, marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                  <span style={{ color: "#4ade80", fontSize: 12 }}>{ev.channel}</span>
                  <span style={{ color: "#6e6e8e", fontSize: 11 }}>{ev.direction}</span>
                </div>
                <pre style={{ background: "#0a0a0f", border: "1px solid #1e1e2e", borderRadius: 4, padding: 14, margin: "0 0 12px", fontSize: 12, color: "#c8c8d8", overflowX: "auto" }}>{ev.example}</pre>
                <div style={{ color: "#9898b8", fontSize: 12, lineHeight: 1.6 }}>{ev.note}</div>
              </div>
            ))}

            <div style={{ background: "#0f0f1a", border: "1px solid #1e1e2e", borderRadius: 6, padding: 18, marginTop: 8 }}>
              <div style={{ color: "#f59e0b", fontSize: 11, marginBottom: 12 }}>REQUEST LIFECYCLE (happy path)</div>
              <pre style={{ color: "#c8c8d8", margin: 0, fontSize: 12, lineHeight: 2.0 }}>{`
  Client ──[WS msg]──► Gateway
    1. Validate JWT → extract userId
    2. Load roles from ws:sessions:{connId}
    3. Check RBAC: roles allow terminal:exec?
    4. Assign traceId
    5. PUBLISH terminal:commands {traceId, userId, roles, action, payload, replyTo}

  Terminal Service (subscribed to terminal:commands)
    6. Validate event schema
    7. Re-check roles on payload (defence in depth)
    8. Spawn / reuse pty for userId
    9. Stream output chunks → PUBLISH terminal:results:{sessionId} {stream, done}

  Gateway (subscribed to terminal:results:{sessionId})
    10. Forward each chunk over client WebSocket
    11. On done:true → close subscription or keep for next command

  Audit Stream
    12. Every step emits XADD audit:stream {traceId, step, ts, userId}
  `}</pre>
            </div>
          </div>
        )}

        {/* RBAC & GATEWAY */}
        {active === "rbac" && (
          <div>
            <h2 style={{ color: "#818cf8", marginBottom: 4, fontSize: 16 }}>RBAC & Gateway Design</h2>
            <p style={{ color: "#6e6e8e", marginBottom: 24, lineHeight: 1.7 }}>
              The gateway is the single enforcement point. No service handles authentication. Services trust the role payload on the event because the gateway signed the event.
            </p>

            <div style={{ marginBottom: 20 }}>
              <div style={{ color: "#f472b6", fontSize: 11, marginBottom: 12 }}>ROLE MODEL</div>
              {rbacModel.map((r) => (
                <div key={r.role} style={{ background: "#0f0f1a", border: "1px solid #1e1e2e", borderRadius: 6, padding: 16, marginBottom: 10 }}>
                  <div style={{ color: "#f472b6", fontSize: 13, marginBottom: 8 }}>role: {r.role}</div>
                  <div style={{ display: "flex", gap: 20 }}>
                    <div>
                      <div style={{ color: "#6e6e8e", fontSize: 11, marginBottom: 6 }}>ALLOW</div>
                      {r.permissions.map(p => (
                        <div key={p} style={{ color: "#4ade80", fontSize: 12, lineHeight: 1.7 }}>✓ {p}</div>
                      ))}
                    </div>
                    {r.deny.length > 0 && (
                      <div>
                        <div style={{ color: "#6e6e8e", fontSize: 11, marginBottom: 6 }}>DENY</div>
                        {r.deny.map(p => (
                          <div key={p} style={{ color: "#ef4444", fontSize: 12, lineHeight: 1.7 }}>✗ {p}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ background: "#0f0f1a", border: "1px solid #1e1e2e", borderRadius: 6, padding: 18, marginBottom: 16 }}>
              <div style={{ color: "#f59e0b", fontSize: 11, marginBottom: 12 }}>GATEWAY MIDDLEWARE STACK (per request)</div>
              <pre style={{ color: "#c8c8d8", margin: 0, fontSize: 12, lineHeight: 2.0 }}>{`
  ① TLS Termination       — certs from env, never from disk at app start
  ② CORS / Origin check   — whitelist of allowed client origins
  ③ JWT Verification      — RS256, short-lived (15m) + refresh token rotation
  ④ Session Hydration     — load ws:sessions:{connId} from Redis
  ⑤ RBAC Check            — match (userId, roles) against requested {service}:{action}
  ⑥ Rate Limiting         — per-user token bucket in Redis
  ⑦ Event Construction    — attach traceId, userId, roles to event
  ⑧ Publish to Redis      — PUBLISH {service}:commands {event}
  ⑨ Subscribe to reply    — SUBSCRIBE {service}:results:{sessionId}
  ⑩ Audit Log             — XADD audit:stream {traceId, userId, action, ts}
  `}</pre>
            </div>

            <div style={{ background: "#0f0f1a", border: "1px solid #1e1e2e", borderRadius: 6, padding: 18 }}>
              <div style={{ color: "#f59e0b", fontSize: 11, marginBottom: 12 }}>CAPABILITY TOKENS FOR EXTENSIONS</div>
              <pre style={{ color: "#c8c8d8", margin: 0, fontSize: 12, lineHeight: 1.8 }}>{`
  // Extension receives a scoped JWT with:
  {
    "sub": "extension:my-plugin-id",
    "roles": ["extension:my-plugin-id"],
    "permissions": ["ai:chat", "fs:read:/workspace/**"],
    "exp": now + 3600
  }

  // Gateway: if role starts with "extension:", apply
  // the strictest subset of permissions — no wildcards allowed.
  // Extension cannot escalate to developer or admin.
  `}</pre>
            </div>
          </div>
        )}

        {/* MIGRATION PATH */}
        {active === "migration" && (
          <div>
            <h2 style={{ color: "#818cf8", marginBottom: 4, fontSize: 16 }}>Migration Path — Phased Delivery</h2>
            <p style={{ color: "#6e6e8e", marginBottom: 24, lineHeight: 1.7 }}>
              Don't rewrite everything at once. Each phase delivers a working, testable system with clear before/after boundaries.
            </p>
            {migrationSteps.map((step, i) => (
              <div key={i} style={{ display: "flex", gap: 16, marginBottom: 20 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#1e1e2e", border: "2px solid #818cf8", display: "flex", alignItems: "center", justifyContent: "center", color: "#818cf8", fontSize: 13, flexShrink: 0 }}>{i + 1}</div>
                  {i < migrationSteps.length - 1 && <div style={{ width: 2, flex: 1, background: "#1e1e2e", marginTop: 6 }} />}
                </div>
                <div style={{ flex: 1, background: "#0f0f1a", border: "1px solid #1e1e2e", borderRadius: 6, padding: 18, marginBottom: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                    <span style={{ color: "#6e6e8e", fontSize: 11 }}>{step.phase}</span>
                    <span style={{ color: "#c8c8d8", fontSize: 13 }}>{step.title}</span>
                    <span style={{ marginLeft: "auto", color: "#4ade80", fontSize: 11 }}>{step.duration}</span>
                  </div>
                  <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                    {step.tasks.map((t, j) => (
                      <li key={j} style={{ color: "#9898b8", fontSize: 12, lineHeight: 1.9, display: "flex", gap: 8 }}>
                        <span style={{ color: "#818cf8" }}>→</span> {t}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
            <div style={{ background: "#0a1a0a", border: "1px solid #1e3e1e", borderRadius: 6, padding: 18 }}>
              <div style={{ color: "#4ade80", fontSize: 11, marginBottom: 8 }}>KEY PRINCIPLE THROUGHOUT</div>
              <div style={{ color: "#9898b8", fontSize: 12, lineHeight: 1.8 }}>
                At no point should any service be able to import another service's code directly in production.
                The only shared code is <span style={{ color: "#c8c8d8" }}>packages/event-contracts</span> (types + channel names).
                Everything else communicates through Redis. If you can't write an integration test that starts two processes
                and sends a Redis message between them, the service boundary is not real.
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
