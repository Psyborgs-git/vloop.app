/**
 * AI Configuration — SQLite Migrations.
 *
 * All tables are CREATE IF NOT EXISTS (idempotent).
 * Called once during boot via AIConfigStore.migrate().
 */

export const AI_CONFIG_MIGRATION = `
-- ─── Provider Configs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_providers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    type        TEXT NOT NULL CHECK(type IN ('openai','anthropic','ollama','google','groq','custom')),
    adapter     TEXT,
    auth_type   TEXT,
    base_url    TEXT,
    api_key_ref TEXT,
    headers     TEXT DEFAULT '{}',
    timeout_ms  INTEGER,
    metadata    TEXT DEFAULT '{}',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Model Configs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_models (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    provider_id TEXT NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
    model_id    TEXT NOT NULL,
    runtime     TEXT,
    supports_tools INTEGER,
    supports_streaming INTEGER,
    params      TEXT DEFAULT '{}',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(provider_id, model_id)
);

-- ─── Tool Configs ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_tools (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL UNIQUE,
    description       TEXT NOT NULL DEFAULT '',
    parameters_schema TEXT DEFAULT '{}',
    handler_type      TEXT NOT NULL CHECK(handler_type IN ('builtin','script','api')),
    handler_config    TEXT DEFAULT '{}',
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
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
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Workflow Configs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_workflows (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    type        TEXT NOT NULL CHECK(type IN ('sequential','parallel','loop')),
    steps       TEXT DEFAULT '[]',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Chat Sessions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_chat_sessions (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT REFERENCES ai_agents(id) ON DELETE SET NULL,
    workflow_id TEXT REFERENCES ai_workflows(id) ON DELETE SET NULL,
    model_id    TEXT REFERENCES ai_models(id) ON DELETE SET NULL,
    provider_id TEXT REFERENCES ai_providers(id) ON DELETE SET NULL,
    mode        TEXT,
    title       TEXT NOT NULL DEFAULT 'New Chat',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Chat Messages ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id           TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
    role         TEXT NOT NULL CHECK(role IN ('system','user','assistant','tool')),
    content      TEXT NOT NULL DEFAULT '',
    provider_type TEXT,
    model_id     TEXT,
    tool_calls   TEXT,
    tool_results TEXT,
    finish_reason TEXT,
    usage        TEXT,
    latency_ms   INTEGER,
    metadata     TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON ai_chat_messages(session_id, created_at);

-- ─── Memory Entries ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_memories (
    id         TEXT PRIMARY KEY,
    session_id TEXT REFERENCES ai_chat_sessions(id) ON DELETE SET NULL,
    agent_id   TEXT REFERENCES ai_agents(id) ON DELETE SET NULL,
    content    TEXT NOT NULL,
    source_type TEXT,
    importance REAL,
    topic      TEXT,
    entities   TEXT,
    metadata   TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memories_agent ON ai_memories(agent_id);
`;
