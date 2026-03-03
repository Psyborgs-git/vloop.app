/**
 * AI Agent v2 — Idempotent DDL migration.
 *
 * Called once at startup.  All statements are CREATE IF NOT EXISTS.
 * New tables: ai_sessions, ai_messages (DAG), ai_state_nodes (DAG),
 * ai_executions, ai_worker_runs, ai_hitl_waits, ai_audit_events,
 * ai_workflow_versions, and associated indexes.
 */

export const V2_MIGRATION = `
-- ─── Schema version marker ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT OR IGNORE INTO ai_schema_meta(key, value) VALUES ('schema_version', '2');

-- ─── Provider Configs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_providers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    type        TEXT NOT NULL,
    adapter     TEXT,
    auth_type   TEXT,
    base_url    TEXT,
    api_key_ref TEXT,
    headers     TEXT DEFAULT '{}',
    timeout_ms  INTEGER,
    metadata    TEXT DEFAULT '{}',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- ─── Model Configs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_models (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    provider_id        TEXT NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
    model_id           TEXT NOT NULL,
    runtime            TEXT,
    supports_tools     INTEGER,
    supports_streaming INTEGER,
    params             TEXT DEFAULT '{}',
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    UNIQUE(provider_id, model_id)
);

-- ─── Tool Configs ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_tools (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL UNIQUE,
    description       TEXT NOT NULL DEFAULT '',
    parameters_schema TEXT DEFAULT '{}',
    handler_type      TEXT NOT NULL,
    handler_config    TEXT DEFAULT '{}',
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

-- ─── MCP Servers ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_mcp_servers (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL UNIQUE,
    protocol_version TEXT,
    capabilities     TEXT DEFAULT '[]',
    transport        TEXT NOT NULL,
    handler_config   TEXT DEFAULT '{}',
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

-- ─── Agent Configs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_agents (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    description   TEXT NOT NULL DEFAULT '',
    model_id      TEXT NOT NULL REFERENCES ai_models(id) ON DELETE RESTRICT,
    system_prompt TEXT NOT NULL DEFAULT '',
    tool_ids      TEXT DEFAULT '[]',
    params        TEXT DEFAULT '{}',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_agent_tools (
    agent_id   TEXT NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
    tool_id    TEXT NOT NULL REFERENCES ai_tools(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (agent_id, tool_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_tools_agent ON ai_agent_tools(agent_id);

CREATE TABLE IF NOT EXISTS ai_agent_mcp_servers (
    agent_id   TEXT NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
    server_id  TEXT NOT NULL REFERENCES ai_mcp_servers(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (agent_id, server_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_mcp_servers_agent ON ai_agent_mcp_servers(agent_id);

-- ─── Workflows ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_workflows (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    type        TEXT NOT NULL,
    nodes       TEXT DEFAULT '[]',
    edges       TEXT DEFAULT '[]',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_workflow_versions (
    id              TEXT PRIMARY KEY,
    workflow_id     TEXT NOT NULL REFERENCES ai_workflows(id) ON DELETE CASCADE,
    version         INTEGER NOT NULL,
    nodes           TEXT DEFAULT '[]',
    edges           TEXT DEFAULT '[]',
    status          TEXT NOT NULL DEFAULT 'active',
    activated_at    TEXT NOT NULL,
    deactivated_at  TEXT,
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wf_versions_wf ON ai_workflow_versions(workflow_id);

-- ─── Sessions (v2 — DAG head tracking) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_sessions (
    id              TEXT PRIMARY KEY,
    agent_id        TEXT REFERENCES ai_agents(id) ON DELETE SET NULL,
    workflow_id     TEXT REFERENCES ai_workflows(id) ON DELETE SET NULL,
    model_id        TEXT REFERENCES ai_models(id) ON DELETE SET NULL,
    provider_id     TEXT REFERENCES ai_providers(id) ON DELETE SET NULL,
    mode            TEXT,
    title           TEXT NOT NULL DEFAULT 'New Chat',
    head_message_id TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_session_tools (
    session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
    tool_id    TEXT NOT NULL REFERENCES ai_tools(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, tool_id)
);
CREATE INDEX IF NOT EXISTS idx_session_tools_session ON ai_session_tools(session_id);

CREATE TABLE IF NOT EXISTS ai_session_mcp_servers (
    session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
    server_id  TEXT NOT NULL REFERENCES ai_mcp_servers(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, server_id)
);
CREATE INDEX IF NOT EXISTS idx_session_mcp_servers ON ai_session_mcp_servers(session_id);

-- ─── Messages (v2 — DAG) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_messages (
    id            TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
    parent_id     TEXT REFERENCES ai_messages(id),
    branch        TEXT NOT NULL DEFAULT 'main',
    role          TEXT NOT NULL,
    content       TEXT NOT NULL DEFAULT '',
    tool_calls    TEXT DEFAULT '[]',
    tool_results  TEXT DEFAULT '[]',
    provider_type TEXT,
    model_id      TEXT,
    finish_reason TEXT,
    usage         TEXT,
    latency_ms    INTEGER,
    metadata      TEXT,
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON ai_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_parent  ON ai_messages(parent_id);
CREATE INDEX IF NOT EXISTS idx_messages_branch  ON ai_messages(session_id, branch);

-- ─── State Nodes (v2 — execution DAG) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_state_nodes (
    id            TEXT PRIMARY KEY,
    execution_id  TEXT NOT NULL REFERENCES ai_executions(id) ON DELETE CASCADE,
    parent_id     TEXT REFERENCES ai_state_nodes(id),
    kind          TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'running',
    payload       TEXT DEFAULT '{}',
    checkpoint    TEXT,
    note          TEXT,
    started_at    TEXT NOT NULL,
    completed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_state_nodes_exec   ON ai_state_nodes(execution_id);
CREATE INDEX IF NOT EXISTS idx_state_nodes_parent ON ai_state_nodes(parent_id);

-- ─── Executions ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_executions (
    id                 TEXT PRIMARY KEY,
    type               TEXT NOT NULL,
    session_id         TEXT,
    workflow_id        TEXT,
    agent_id           TEXT,
    status             TEXT NOT NULL DEFAULT 'running',
    input              TEXT NOT NULL,
    final_output       TEXT,
    last_checkpoint_id TEXT,
    worker_run_id      TEXT,
    started_at         TEXT NOT NULL,
    completed_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_executions_session  ON ai_executions(session_id);
CREATE INDEX IF NOT EXISTS idx_executions_workflow ON ai_executions(workflow_id);

-- ─── Worker Runs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_worker_runs (
    id           TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL REFERENCES ai_executions(id) ON DELETE CASCADE,
    thread_id    INTEGER,
    status       TEXT NOT NULL DEFAULT 'starting',
    error        TEXT,
    started_at   TEXT NOT NULL,
    completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_worker_runs_exec ON ai_worker_runs(execution_id);

-- ─── HITL Waits ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_hitl_waits (
    id                    TEXT PRIMARY KEY,
    execution_id          TEXT NOT NULL REFERENCES ai_executions(id) ON DELETE CASCADE,
    state_node_id         TEXT NOT NULL REFERENCES ai_state_nodes(id) ON DELETE CASCADE,
    status                TEXT NOT NULL DEFAULT 'pending',
    tool_context          TEXT DEFAULT '{}',
    runtime_snapshot      TEXT DEFAULT '{}',
    operator_instructions TEXT DEFAULT '',
    user_response         TEXT,
    created_at            TEXT NOT NULL,
    resolved_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_hitl_waits_exec ON ai_hitl_waits(execution_id);

-- ─── Audit Events ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_audit_events (
    id           TEXT PRIMARY KEY,
    execution_id TEXT,
    kind         TEXT NOT NULL,
    payload      TEXT DEFAULT '{}',
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_events_exec ON ai_audit_events(execution_id);

-- ─── Tool Calls ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_tool_calls (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    tool_name  TEXT NOT NULL,
    arguments  TEXT NOT NULL,
    result     TEXT,
    latency_ms INTEGER,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON ai_tool_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_message ON ai_tool_calls(message_id);

-- ─── Memories ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_memories (
    id          TEXT PRIMARY KEY,
    session_id  TEXT,
    agent_id    TEXT,
    content     TEXT NOT NULL,
    source_type TEXT,
    importance  REAL,
    topic       TEXT,
    entities    TEXT,
    metadata    TEXT DEFAULT '{}',
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_agent ON ai_memories(agent_id);

-- ─── Canvases ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS canvases (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL DEFAULT '',
    metadata    TEXT DEFAULT '{}',
    owner       TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canvas_commits (
    id          TEXT PRIMARY KEY,
    canvas_id   TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    diff        TEXT NOT NULL DEFAULT '',
    metadata    TEXT DEFAULT '{}',
    change_type TEXT NOT NULL,
    changed_by  TEXT NOT NULL,
    message     TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_canvas_commits_canvas ON canvas_commits(canvas_id);
`;
