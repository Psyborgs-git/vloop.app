# Orchestrator System — Comprehensive Data Flow Diagrams (DFD)

**Document Purpose:** Detail all major data flows, message transformations, and architectural patterns governing data movement through the Orchestrator daemon and its constituent subsystems.

---

## Table of Contents

1. [DFD Level 0: Context Diagram](#dfd-level-0-context-diagram)
2. [DFD Level 1: Major Subsystems](#dfd-level-1-major-subsystems)
3. [DFD Level 2: Component Interactions](#dfd-level-2-component-interactions)
4. [Data Stores & Schemas](#data-stores--schemas)
5. [External Systems Integration](#external-systems-integration)
6. [Feature-Specific Flows](#feature-specific-flows)
   - [Container Lifecycle Flow](#container-lifecycle-flow)
   - [Process Execution Flow](#process-execution-flow)
   - [AI Agent Orchestration Flow](#ai-agent-orchestration-flow)
   - [Secrets Vault Access Flow](#secrets-vault-access-flow)
   - [Database Provisioning Flow](#database-provisioning-flow)
7. [Authentication & Authorization Flow](#authentication--authorization-flow)
8. [Event Streaming & Bidirectional Communication](#event-streaming--bidirectional-communication)
9. [Data Transformation Pipelines](#data-transformation-pipelines)
10. [Error & Recovery Flows](#error--recovery-flows)

---

## DFD Level 0: Context Diagram

**Level 0 shows the entire system as a single process and its external entities.**

```
                                    ┌────────────────────────────────┐
                                    │  AI Agents / Clients           │
                                    │  (Remote Planners, Operators)  │
                                    └────────────┬───────────────────┘
                                                 │
                      ┌──────────────────────────┼──────────────────────────┐
                      │                          │                          │
                      │    WSS RPC Messages      │    JWT / mTLS Certs      │
                      │    JSON/MessagePack      │                          │
                      │                          │                          │
                      ▼                          ▼                          ▼
                    ┌────────────────────────────────────────────────────┐
                    │   ORCHESTRATOR DAEMON (Host-Level System)          │
                    │                                                    │
                    │  ┌──────────────────────────────────────────────┐ │
                    │  │  • Workload Execution                        │ │
                    │  │  • Secrets Management & Injection            │ │
                    │  │  • Database Engine Provisioning              │ │
                    │  │  • AI Agent Sandbox & Tool Execution         │ │
                    │  │  • Session Management & RBAC                 │ │
                    │  │  • Audit Logging & Compliance Tracking       │ │
                    │  │  • Event Streaming & Bidirectional Comms     │ │
                    │  └──────────────────────────────────────────────┘ │
                    │                                                    │
                    └──────────┬──────────────────┬──────────────────┬───┘
                               │                  │                  │
                    ┌──────────▼──────┐  ┌────────▼────────┐  ┌──────▼──┐
                    │ Container       │  │ OS Kernel      │  │          │
                    │ Runtime         │  │ (Processes)    │  │          │
                    │ Docker/         │  │                │  │          │
                    │ containerd      │  │ Fork/Exec LRPs │  │          │
                    └──────────┬──────┘  │ Reap Signals   │  │          │
                               │         └────────────────┘  │          │
                               │                             │          │
                               └─────────────────────────┬───┘          │
                                                        │               │
                                    ┌───────────────────▼───────────┐
                                    │   Local Filesystem            │
                                    │  • Encrypted SQLite DB        │
                                    │  • Workspace Data             │
                                    │  • Logs & Audit Trails        │
                                    └───────────────────────────────┘
```

**Data Flow Summary (Level 0):**
- **Input:** WebSocket RPC requests (container ops, process spawning, secret requests, agent commands)
- **Processing:** Route → Authenticate → Authorize → Execute → Log
- **Output:** RPC responses (success/error), event streams, audit events
- **Storage:** Encrypted SQLite database for all persistent state

---

## DFD Level 1: Major Subsystems

**Level 1 decomposes the daemon into its major feature domains and shows their relationships.**

```mermaid
graph TB
    C1["AI Agents"]
    C2["Operators / CLI"]
    C3["CI/CD Pipelines"]
    DOCKER["Docker / containerd"]
    FS["Filesystem / OS"]
    
    WSS["WebSocket Server<br/>(TLS 1.3)"]
    HEALTH["Health Endpoints"]
    JWT["JWT Validator"]
    SESSION["Session Manager"]
    RBAC["RBAC Engine"]
    AUDIT["Audit Logger"]
    ROUTER["Dispatch Router"]
    MIDDLEWARE["Middleware Chain"]
    PROC["Process Manager<br/>(LRP)"]
    CONT["Container Manager"]
    VAULT["Secrets Vault"]
    AGENT["AI Orchestrator"]
    DBMGR["Database Manager"]
    CRON["Cron Scheduler"]
    DB["Encrypted<br/>SQLite DB"]
    FS_DATA["Workspace Files"]

    C1 --> WSS
    C2 --> WSS
    C3 --> WSS
    
    WSS --> JWT
    JWT --> SESSION
    SESSION --> RBAC
    
    WSS --> ROUTER
    RBAC --> MIDDLEWARE
    MIDDLEWARE --> ROUTER
    
    ROUTER --> PROC
    ROUTER --> CONT
    ROUTER --> VAULT
    ROUTER --> AGENT
    ROUTER --> DBMGR
    ROUTER --> CRON

    HEALTH --> SESSION
    HEALTH --> PROC
    HEALTH --> CONT
    HEALTH --> VAULT

    PROC --> FS
    CONT --> DOCKER
    VAULT --> DB
    AGENT --> PROC
    AGENT --> CONT
    DBMGR --> DB
    DBMGR --> FS_DATA
    CRON --> PROC

    AUDIT --> DB
```

**Key Subsystems (Level 1):**
1. **Transport:** WSS server, TLS termination, protocol negotiation
2. **Auth & Security:** JWT validation, session tracking, RBAC enforcement, audit logging
3. **Routing:** Message routing, middleware composition, error boundary
4. **Features:** Independent domain managers (Process, Container, Vault, Agent, DB, Cron)
5. **Storage:** Encrypted SQLite for all persistent state

---

## DFD Level 2: Component Interactions

**Level 2 shows detailed message flows and transformation at the component level.**

### 2.1 Inbound Request Flow (Detailed)

```mermaid
sequenceDiagram
    participant Client
    participant WSServer as WS Server
    participant Parser as Protocol Parser
    participant Router as Dispatch Router
    participant Auth as Auth Chain
    participant RBAC as RBAC Engine
    participant Logger as Audit Logger
    participant Handler as Feature Handler
    participant Response

    Client->>WSServer: WSS Frame
    WSServer->>Parser: Raw Bytes
    Parser->>Parser: Decode JSON/MessagePack
    Parser->>Router: Request Object

    Router->>Auth: Extract JWT
    Auth->>Auth: Verify Signature
    Auth->>Router: Session ID

    Router->>RBAC: Check Permission
    RBAC->>RBAC: Query Policy
    RBAC->>Router: ALLOW/DENY

    alt DENIED
        Router->>Logger: Log Event
        Logger->>Router: Logged
        Router->>WSServer: Error
        WSServer->>Client: Error Frame
    else ALLOWED
        Router->>Handler: Dispatch
        Handler->>Handler: Execute
        Handler->>Response: Result
        Response->>WSServer: Serialize
        Router->>Logger: Log
        Logger->>Router: Logged
        WSServer->>Client: Response Frame
    end
```

### 2.2 State Mutation & Persistence

```
   Request Payload        Handler Execution         Database Write
   ───────────────────    ──────────────────       ──────────────────
   
   {payload}              1. Validate schema      1. Begin transaction
                          2. Allocate resources   2. Insert/Update row
                          3. Persist to DB        3. Commit
                          4. Return ID            4. Emit audit event
                          5. Schedule monitoring
```

---

## Data Stores & Schemas

### 3.1 Encrypted SQLite Database Schema

```sql
-- Core Database @ ./data/state.db, encrypted with AES-256-GCM

-- Sessions: Tracks authenticated client connections
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  identity TEXT NOT NULL,
  roles TEXT NOT NULL,
  jwt_sub TEXT,
  issued_at INTEGER,
  expires_at INTEGER,
  last_activity INTEGER,
  metadata JSON,
  revoked BOOLEAN DEFAULT FALSE
);

-- Audit Log: Immutable record of all mutations
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  trace_id TEXT,
  timestamp INTEGER NOT NULL,
  identity TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  payload_hash TEXT NOT NULL,
  prev_hash TEXT,
  outcome TEXT,
  error_code TEXT,
  details JSON
);
CREATE INDEX audit_log_session_id ON audit_log(session_id);
CREATE INDEX audit_log_identity ON audit_log(identity);
CREATE INDEX audit_log_timestamp ON audit_log(timestamp);

-- Secrets: Encrypted vault entries
CREATE TABLE secrets (
  id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  name TEXT NOT NULL,
  secret_type TEXT,
  ciphertext BLOB NOT NULL,
  iv BLOB NOT NULL,
  auth_tag BLOB NOT NULL,
  created_at INTEGER,
  updated_at INTEGER,
  created_by TEXT,
  rotated_count INTEGER DEFAULT 0,
  soft_delete_at INTEGER
);

-- Processes: Long-running process state
CREATE TABLE processes (
  id TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  args JSON,
  cwd TEXT,
  env JSON,
  restart_policy TEXT,
  max_restarts INTEGER DEFAULT 5,
  restart_count INTEGER DEFAULT 0,
  pid INTEGER,
  exit_code INTEGER,
  status TEXT,
  created_at INTEGER,
  started_at INTEGER,
  stopped_at INTEGER,
  last_restart_at INTEGER
);

-- Containers: Container lifecycle tracking
CREATE TABLE containers (
  id TEXT PRIMARY KEY,
  image_ref TEXT NOT NULL,
  name TEXT UNIQUE NOT NULL,
  status TEXT,
  container_id TEXT,
  config JSON,
  created_at INTEGER,
  started_at INTEGER,
  stopped_at INTEGER,
  health_status TEXT,
  requested_by TEXT
);

-- Scheduled Jobs: Cron and scheduled task tracking
CREATE TABLE scheduled_jobs (
  id TEXT PRIMARY KEY,
  schedule_expr TEXT NOT NULL,
  command TEXT NOT NULL,
  args JSON,
  timezone TEXT DEFAULT 'UTC',
  next_run_at INTEGER,
  last_run_at INTEGER,
  last_exit_code INTEGER,
  created_at INTEGER,
  last_updated INTEGER,
  enabled BOOLEAN DEFAULT TRUE,
  retry_count INTEGER DEFAULT 0
);

-- Database Instances: Provisioned databases for workloads
CREATE TABLE database_instances (
  id TEXT PRIMARY KEY,
  engine TEXT NOT NULL,
  workspace_id TEXT,
  name TEXT,
  connection_string BLOB,
  created_at INTEGER,
  expires_at INTEGER,
  accessed_at INTEGER,
  creator_identity TEXT
);
```

### 3.2 File System Layout

```
/var/lib/orchestrator/
├── data/
│   ├── state.db
│   ├── state.db-wal
│   └── workspaces/
│       ├── <workspace-id>/
│       │   ├── env.json
│       │   ├── instance.db
│       │   └── artifacts/
│       └── ...
├── logs/
│   ├── daemon.log
│   └── access.log
└── certs/
    ├── server.crt
    ├── server.key
    └── ca.crt
```

---

## External Systems Integration

### 4.1 Container Runtime (Docker/containerd)

```mermaid
graph LR
    ORCH["Orchestrator<br/>Container Mgr"]
    SOCK["Unix Socket<br/>docker.sock"]
    DOCKER["Docker Daemon<br/>or containerd"]
    REG["Image Registry<br/>DockerHub, ECR"]
    FS_VOL["Filesystem<br/>Volumes"]

    ORCH -->|HTTP over Socket| SOCK
    SOCK -->|API Requests| DOCKER
    DOCKER -->|Pull| REG
    REG -->|Layers| DOCKER
    DOCKER -->|Mount| FS_VOL
    DOCKER -->|Logs/Events| ORCH

    style ORCH fill:#e1f5ff
    style DOCKER fill:#fff3e0
    style REG fill:#f3e5f5
```

**Container Manager Data Flow:**
```
1. Client RPC: container.create(image, name, config)
   ↓
2. Image Validation (local cache check)
   ↓
3. If missing: Registry Pull (async)
   ↓
4. HTTP POST /containers/create over Unix socket
   ↓
5. Docker returns container ID
   ↓
6. Database entry: INSERT containers(...)
   ↓
7. Return container_id to client
   ↓
8. container.start(container_id)
   ↓
9. HTTP POST /containers/{id}/start
   ↓
10. Stream logs: Continuous WSS frames to client
```

### 4.2 OS Process Spawning

```
1. Client RPC: process.spawn(command, args, env, restartPolicy)
   ↓
2. Validation: command exists, args array, restart policy enum
   ↓
3. Allocate process object (ID generation)
   ↓
4. Database: INSERT processes(...)
   ↓
5. child_process.spawn(command, args, {env, stdio})
   ↓
6. Pipes: stdout and stderr to ring buffer
   ↓
7. Store PID, mark status='running'
   ↓
8. Monitor child:
    - on 'exit' → capture exit_code
    - Health check (heartbeat, memory, CPU)
    - Restart logic (if enabled)
   ↓
9. Event streaming to client: process.logs, process.status
```

---

## Feature-Specific Flows

### 5.1 Container Lifecycle Flow

```mermaid
stateDiagram-v2
    [*] --> Pull: container.create()
    Pull --> CreateCtr: Image ready
    CreateCtr --> Created: HTTP POST
    Created --> Starting: container.start()
    Starting --> Running: HTTP POST
    Running --> HealthCheck: Heartbeat
    HealthCheck --> Running: Healthy
    HealthCheck --> Degraded: Unhealthy
    Degraded --> Restarting: Restart Policy
    Restarting --> Running: Restarted
    Running --> Stopping: container.stop()
    Stopping --> Stopped: SIGTERM
    Stopped --> Removing: container.remove()
    Removing --> [*]: Deleted
    Running --> Error: Crash/OOM
    Error --> Removing: Cleanup
    Removing --> [*]
```

### 5.2 Process Execution Flow

```
┌──────────────────────────────────────────────────────────────┐
│              Process Lifecycle                               │
└──────────────────────────────────────────────────────────────┘

    Client Request
    process.spawn({...})
         │
         ▼
    ┌──────────────────────────────────────┐
    │  Validation & Persistence              │
    │  • Command validation                  │
    │  • DB INSERT processes                 │
    │  • Generate unique ID                  │
    └──────────┬───────────────────────────┘
               │
               ▼
    ┌──────────────────────────────────────┐
    │  child_process.spawn()                 │
    │  • Fork into child                     │
    │  • Set stdio pipes                     │
    │  • Set environment variables           │
    └──────────┬───────────────────────────┘
               │
         ┌─────┴─────┐
         │           │
         ▼           ▼
    ┌────────┐  ┌──────────┐
    │ stdout │  │ stderr   │
    └────┬───┘  └────┬─────┘
         │           │
         ▼           ▼
    ┌──────────────────────────────────────┐
    │  Ring Buffer                           │
    │  • Last 1000 lines                     │
    │  • UTF-8 parsing                       │
    └────────┬───────────────────────────┘
             │
             ▼
    ┌──────────────────────────────────────┐
    │  WebSocket Event Emission              │
    │  process.logs {lines, cursor}         │
    └──────────────────────────────────────┘

    ┌──────────────────────────────────────┐
    │  Process Monitoring Loop              │
    │  • Poll exit code                      │
    │  • Heartbeat                           │
    │  • Restart on failure                  │
    └──────────────────────────────────────┘
```

### 5.3 AI Agent Orchestration Flow

```mermaid
sequenceDiagram
    participant Client as AI Planner<br/>Client
    participant Orch as Orchestrator
    participant Sandbox as Agent<br/>Sandbox
    participant Tools as Tool<br/>Registry
    participant Proc as Process<br/>Manager
    participant Cont as Container<br/>Manager
    participant DB as State DB

    Client->>Orch: agent.execute(request)
    Orch->>Sandbox: Create sandbox
    Sandbox->>DB: Load agent meta
    Sandbox->>Sandbox: Inject context
    Sandbox->>Tools: Init tools

    loop Agent iteration
        Sandbox->>Sandbox: Invoke LLM
        alt spawn_process
            Tools->>Proc: process.spawn()
            Proc-->>Tools: {processId}
            Tools-->>Sandbox: result
        else spawn_container
            Tools->>Cont: container.create()
            Cont-->>Tools: {containerId}
            Tools-->>Sandbox: result
        else read_secret
            Tools->>DB: SELECT secret
            DB-->>Tools: ciphertext
            Tools->>Tools: Decrypt
            Tools-->>Sandbox: secret_value
        else query_db
            Tools->>DB: Execute query
            DB-->>Tools: rows
            Tools-->>Sandbox: result
        else done
            Sandbox->>DB: Store trace
            Sandbox-->>Orch: completion
        end
    end

    Orch-->>Client: agent.result
```

### 5.4 Secrets Vault Access Flow

```
Client RPC: vault.secret.get(name)
    │
    ▼
┌───────────────────────────┐
│  RBAC Check                │
│  (vault:secret.get)       │
└─────────┬─────────────────┘
          │
    ┌─────▼──────┐
    │  ALLOWED?  │
    └─────┬──────┘
          │
    ┌─────▼──────────────────────────────┐
    │  Database Query                     │
    │  SELECT ciphertext, iv, auth_tag   │
    │  FROM secrets WHERE name = ?       │
    └─────┬──────────────────────────────┘
          │
    ┌─────▼──────────────────────────────┐
    │  Vault Crypto Module                │
    │  • Get Master Encryption Key        │
    │  • Decrypt: AES-256-GCM             │
    │    - ciphertext                      │
    │    - IV                              │
    │    - auth_tag validation             │
    └─────┬──────────────────────────────┘
          │
    ┌─────▼──────────────────────────┐
    │  Environment Injection           │
    │  • Set env var from plaintext    │
    │  • Never write to disk           │
    │  • Plaintext only in memory      │
    └──────────────────────────────┬─┘
                                   │
                                   ▼
                           Return to client
                           or inject into
                           subprocess
```

### 5.5 Database Provisioning Flow

```mermaid
sequenceDiagram
    participant Agent as AI Agent/<br/>Workload
    participant Orch as Orchestrator
    participant DBMgr as DB Manager
    participant Vault as Vault
    participant DBEngine as DB Engine
    participant LocDB as Local DB

    Agent->>Orch: db.provision()
    Orch->>DBMgr: Request DB
    DBMgr->>DBMgr: Generate path
    DBMgr->>LocDB: Create/Open DB
    LocDB-->>DBMgr: Handle

    DBMgr->>Vault: Generate creds
    Vault-->>DBMgr: {token, ttl}
    DBMgr->>DBMgr: INSERT instance
    DBMgr-->>Orch: {db_id}
    Orch-->>Agent: Connection

    Agent->>DBEngine: Connect()
    DBEngine->>LocDB: SQL
    LocDB-->>DBEngine: Results
    DBEngine-->>Agent: Data

    Note over Agent, LocDB: On completion or TTL:\nClose, revoke creds,\ncleanup
```

---

## Authentication & Authorization Flow

### 6.1 JWT Authentication & Session Establishment

```
┌─────────────────────────────────────────────────────────────┐
│          JWT Authentication Flow                            │
└─────────────────────────────────────────────────────────────┘

1. Client Initial Connection
   
   Client sends:
   {
     "token": "eyJhbGciOiJSUzI1NiI...",
     "protocol": "json"
   }
         │
         ▼
   ┌──────────────────────────────────┐
   │  JWT Validator                    │
   │  • Load public key                │
   │  • Verify signature (RS256)       │
   │  • Check iat, exp, aud, iss       │
   └──────────┬───────────────────────┘
              │
   If FAILS:
   ├─→ AUTH_FAILED
   └─→ Close connection
   
   If PASSES:
         │
         ▼
   ┌──────────────────────────────────┐
   │  Extract Claims                   │
   │  • sub (subject)                  │
   │  • aud (audience)                 │
   │  • scope (if present)             │
   │  • custom fields                  │
   └──────────┬───────────────────────┘
              │
         ▼
   ┌──────────────────────────────────┐
   │  Session Creation                 │
   │  • Generate session_id (uuid)     │
   │  • Determine roles from claims    │
   │  • Store in sessions table        │
   │  • Record issued_at, expires_at  │
   └──────────┬───────────────────────┘
              │
         ▼
   Return: {
     session_id: "sess_abc123",
     identity: "user@org",
     roles: ["admin"]
   }

2. Subsequent Request Flow
   
   Client sends RPC with session_id in meta:
   {
     "id": "msg_1",
     "topic": "process",
     "meta": {
       "session_id": "sess_abc123"
     }
   }
         │
         ▼
   ┌───────────────────────────────┐
   │  Session Lookup               │
   │  • Query sessions table        │
   │  • Check: not revoked         │
   │  • Check: not expired         │
   │  • Check: active              │
   └───────┬───────────────────────┘
           │
   If invalid:
   ├─→ AUTH_REQUIRED
   └─→ Close
   
   If valid:
           │
           ▼
   ┌──────────────────────────────────┐
   │  Update Last Activity              │
   │  UPDATE sessions SET last_activity │
   └──────────────────────────────────┘
```

### 6.2 Role-Based Access Control (RBAC) Enforcement

```
Inbound RPC Request
Request: {topic: "vault", action: "secret.delete"}
         │
         ▼
┌─────────────────────────────────┐
│  Extract Authorization Context   │
│  • Identity: "alice@org"         │
│  • Roles: ["viewer", "operator"] │
└──────────┬────────────────────┘
           │
      ┌────▼─────────────────────┐
      │  Policy Matching          │
      └────┬────────────────────┘
           │
      ┌────▼─────────────────────────────┐
      │  Load RBAC Rules (policies.toml)  │
      │                                   │
      │  [roles.viewer]                   │
      │  allow = ["vault:secret.get:*"]  │
      │                                   │
      │  [roles.operator]                 │
      │  allow = ["container:*:*", ...]  │
      └────┬────────────────────────────┘
           │
      ┌────▼──────────┐
      │  Permission?  │
      └────┬──────────┘
           │
      Requested: vault:secret.delete:*
      User Roles: ["viewer", "operator"]
      Allowed by viewer: no
      Allowed by operator: no
           │
           ▼
       PERMISSION DENIED
```

---

## Event Streaming & Bidirectional Communication

### 7.1 Log Streaming Architecture

```
┌────────────────────────────────────────────────────┐
│  Long-Running Process (spawned via spawn())        │
└────────────┬───────────────────────────────────────┘
             │
    ┌────────┴────────┐
    │                 │
    ▼                 ▼
┌────────┐       ┌──────────┐
│ stdout │       │ stderr   │
└───┬────┘       └────┬─────┘
    │                 │
    └────────┬────────┘
             │
             ▼
    ┌───────────────────────┐
    │  Ring Buffer          │
    │  • Last 1000 lines    │
    │  • UTF-8 parsing      │
    │  • Cursor tracking    │
    └────────┬──────────────┘
             │
    ┌────────┴────────┐
    │                 │
    ▼                 ▼
Historical Tail   Event Stream
(on request)      (continuous)

Client: process.logs.tail(processId)
  ↓
Return: {lines, cursor}

  vs.

Client: Subscribe to stream
  ↓
Server (every 100ms or 50 lines):
{
  type: "stream",
  payload: {
    processId, lines, cursor
  }
}
```

### 7.2 Container Event Streaming

```mermaid
sequenceDiagram
    participant Client as Client/<br/>Watcher
    participant Orch as Orchestrator
    participant Docker as Docker<br/>Daemon
    participant EventLoop as Event<br/>Loop

    Client->>Orch: container.watch()
    Orch->>Docker: HTTP GET /events
    Docker-->>EventLoop: Streaming

    loop Event Stream
        Docker->>EventLoop: Event
        EventLoop->>Orch: Parse
        Orch->>Orch: Filter
        Orch-->>Client: WSS frame
    end

    Note over Client, Docker: Events: started, stopped,<br/>died, health_status
```

---

## Data Transformation Pipelines

### 8.1 Inbound Message Transformation

```
Raw WebSocket Frame
         │
         ▼
┌──────────────────────────────┐
│  Protocol Detection & Parsing │
│  • MessagePack or JSON        │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│  Request Schema Validation    │
│  Zod: {                      │
│    id: string,               │
│    topic: enum,              │
│    action: string,           │
│    payload: unknown,         │
│    meta: {...}               │
│  }                           │
└──────────┬───────────────────┘
           │
    ┌──────▼──────┐
    │  Valid?     │
    └──────┬──────┘
           │
  Yes      │      No
   │       │       │
   │       └───────┼─────┐
   │               │     │
   ▼               │     ▼
Continue       Schema   Error
               Error    Response

           │
           ▼
┌──────────────────────────────┐
│  Feature-Specific Validation  │
│  Handler validation           │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│  Enriched Request Context     │
│  {                           │
│    request,                  │
│    session,                  │
│    identity,                 │
│    logger,                   │
│    trace_id                  │
│  }                           │
└──────────────────────────────┘
```

### 8.2 Response Transformation & Serialization

```
Handler Result
{processId, pid, status}
         │
         ▼
┌──────────────────────────────┐
│  Response Envelope Wrapping   │
│  {                           │
│    id,                       │
│    type: "response",         │
│    topic,                    │
│    action,                   │
│    payload,                  │
│    meta: {timestamp, trace}  │
│  }                           │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│  Negotiated Serialization     │
│  • MessagePack (compact)     │
│  • or JSON (readable)        │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│  WebSocket Frame Framing      │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│  TLS Encryption (WSS)         │
│  • TLS 1.3                    │
│  • AES-256-GCM                │
└──────────┬───────────────────┘
           │
           ▼
    Transmitted to Client
```

---

## Error & Recovery Flows

### 9.1 Error Boundary & Recovery

```
Handler Execution
         │
         ▼
┌─────────────────────┐
│  Catch Exception    │
│  try { exec() }     │
└────────┬────────────┘
         │
   ┌─────▼────┐
   │  Caught? │
   └─────┬────┘
         │
  Yes    │    No
   │     │     │
   │     │     └──→ Graceful return
   │     │
   ▼     
┌──────────────────────────────┐
│  Error Classification         │
│  • OrchestratorError          │
│  • Runtime Error              │
│  • Unknown Error              │
└─────────┬────────────────────┘
          │
          ▼
┌──────────────────────────────┐
│  Extract Error Context        │
│  • Error code                  │
│  • Message                     │
│  • Stack trace (debug mode)    │
│  • User-facing message         │
└─────────┬────────────────────┘
          │
          ▼
┌──────────────────────────────┐
│  Audit Log Entry              │
│  {                           │
│    action,                   │
│    outcome: "FAILURE",       │
│    error_code,               │
│    error_message,            │
│    timestamp                 │
│  }                           │
└─────────┬────────────────────┘
          │
          ▼
┌──────────────────────────────┐
│  Response to Client           │
│  {                           │
│    type: "error",            │
│    error,                    │
│    message,                  │
│    trace_id                  │
│  }                           │
└──────────────────────────────┘
```

### 9.2 Daemon Restart & State Recovery

```
Daemon Crash / SIGTERM
         │
         ▼
┌────────────────────────────────┐
│  Graceful Shutdown              │
│  1. Stop accepting WSS          │
│  2. Close connections           │
│  3. Drain in-flight requests    │
└────────┬───────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│  Flush State to DB              │
│  • Update processes (stopped)   │
│  • Finalize audit entries       │
│  • Close DB                     │
└────────┬───────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│  Daemon Exits (code 0)          │
└────────┬───────────────────────┘
         │
    Restart (if enabled)
         │
         ▼
┌────────────────────────────────┐
│  Recovery Boot Sequence         │
│  1. Parse config                │
│  2. Open encrypted DB           │
│  3. Read scheduler jobs         │
│  4. Reconnect to container mgmt │
│  5. Restore session cache       │
│  6. Resume scheduler            │
└────────┬───────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│  Reconstruct Running State      │
│  • Query processes table        │
│  • Check: still running?        │
│  • Check containers alive?      │
│  • Update statuses              │
└────────┬───────────────────────┘
         │
         ▼
    Ready for Connections
```

---

## Summary: Data Flow Across All Domains

```
External Actors
├─ AI Agents
├─ Operators/CLI
└─ CI/CD Systems
        │
        │ (WSS RPC Requests)
        ▼
┌──────────────────────────────┐
│    WebSocket Transport        │
│  • TLS 1.3 Termination        │
│  • Subprotocol Negotiation    │
│  • Heartbeat (Ping/Pong)      │
└──────────┬───────────────────┘
           │
      ┌────▼─────┐
      │JWT Valid?│
      └────┬─────┘
           │
      ┌────▼─────────┐
      │Session Mgr   │
      └────┬─────────┘
           │
      ┌────▼────┐
      │RBAC OK? │
      └────┬────┘
           │
      ┌────▼──────────┐
      │Dispatch Route │
      └────┬──────────┘
           │
┌──────────┼──────────┬────────────┬──────────────┬──────────┐
│          │          │            │              │          │
▼          ▼          ▼            ▼              ▼          ▼
Process  Container Vault       Agent         Database    Scheduler
Mgr      Mgr       Mgr         Mgr           Mgr

All mutations logged → Audit Trail (hash chain)
All data encrypted at rest
All transport encrypted (TLS 1.3)
```

---

## Appendix: Message Type Reference

### Request Message
```json
{
  "id": "msg_12345",
  "type": "request",
  "topic": "process",
  "action": "spawn",
  "payload": {
    "command": "/bin/bash",
    "args": ["script.sh"],
    "env": {"VAR": "value"},
    "restartPolicy": "on-failure"
  },
  "meta": {
    "session_id": "sess_abc",
    "trace_id": "trace_xyz",
    "timestamp": "2026-02-22T18:30:00Z"
  }
}
```

### Success Response
```json
{
  "id": "msg_12345",
  "type": "response",
  "topic": "process",
  "action": "spawn",
  "payload": {
    "processId": "proc_1",
    "pid": 12345,
    "status": "running"
  },
  "meta": {
    "timestamp": "2026-02-22T18:30:01Z",
    "trace_id": "trace_xyz"
  }
}
```

### Error Response
```json
{
  "id": "msg_12345",
  "type": "error",
  "topic": "process",
  "action": "spawn",
  "payload": {
    "error": "INVALID_REQUEST",
    "message": "Command not found",
    "code": "COMMAND_NOT_FOUND"
  },
  "meta": {
    "timestamp": "2026-02-22T18:30:01Z",
    "trace_id": "trace_xyz"
  }
}
```

### Stream Frame
```json
{
  "id": "msg_12345",
  "type": "stream",
  "topic": "process",
  "action": "logs",
  "payload": {
    "processId": "proc_1",
    "lines": [
      {
        "timestamp": "2026-02-22T18:30:01.500Z",
        "text": "Starting..."
      }
    ],
    "cursor": 42
  },
  "meta": {
    "timestamp": "2026-02-22T18:30:01.500Z",
    "trace_id": "trace_xyz",
    "seq": 1
  }
}
```

---

**Document Version:** 1.0  
**Last Updated:** 2026-02-22  
**Status:** Complete - All Mermaid Diagrams Fixed
