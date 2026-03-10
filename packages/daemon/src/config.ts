/**
 * Configuration loader for the Orchestrator daemon.
 *
 * Loads from TOML file, overlays environment variables using the ORCH_ prefix,
 * and validates the result against a Zod schema.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseTOML } from 'smol-toml';
import { z } from 'zod';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { OrchestratorConfig } from '@orch/shared';

// ─── Zod Schema ──────────────────────────────────────────────────────────────

const DaemonSection = z.object({
    pid_file: z.string().default('/var/run/orchestrator.pid'),
    log_level: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
    foreground: z.boolean().default(false),
});

const NetworkSection = z.object({
    bind_address: z.string().default('0.0.0.0'),
    ws_port: z.number().int().min(1).max(65535).default(9443),
    health_port: z.number().int().min(1).max(65535).default(9444),
    canvas_port: z.number().int().min(1).max(65535).default(9445),
    mcp_port: z.number().int().min(1).max(65535).default(9446),
    max_connections: z.number().int().min(1).default(1000),
    ping_interval_secs: z.number().int().min(1).default(30),
    pong_timeout_secs: z.number().int().min(1).default(10),
    max_message_size_bytes: z.number().int().min(1024).default(1_048_576),
});

const TlsSection = z.object({
    cert_path: z.string(),
    key_path: z.string(),
});

const AuthSection = z.object({
    jwt_public_key_path: z.string(),
    jwt_algorithm: z.enum(['RS256', 'ES256', 'EdDSA']).default('RS256'),
    jwt_issuer: z.string().default('orchestrator'),
    jwt_audience: z.string().default('orchestrator-api'),
    session_idle_timeout_secs: z.number().int().min(60).default(3600),
    session_max_lifetime_secs: z.number().int().min(600).default(86400),
    max_sessions_per_identity: z.number().int().min(1).default(10),
    default_token_ttl_secs: z.number().int().min(0).default(604800),
    max_tokens_per_identity: z.number().int().min(1).default(50),
});

const DatabaseSection = z.object({
    engine: z.enum(['sqlite', 'mysql', 'postgres']).default('sqlite'),
    path: z.string().default('./data/state.db'),
    postgres_url: z.string().optional(),
    mysql_url: z.string().optional(),
});

const VaultSection = z.object({
    max_secret_versions: z.number().int().min(1).default(5),
    soft_delete_retention_days: z.number().int().min(1).default(30),
});

const ContainerdSection = z.object({
    socket_path: z.string().default('/run/containerd/containerd.sock'),
    namespace: z.string().default('orchestrator'),
}).optional();

const StorageSection = z.object({
    canvas_path: z.string().default('./data/canvases'),
});

const ApplicationsSection = z.object({
    installed: z.array(z.string()).default([]),
});

const TerminalSection = z.object({
    log_path: z.string().default('./data/terminal-logs'),
});

const DbManagerSection = z.object({
    workspaces_path: z.string().default('./data/workspaces'),
});

const AiAgentSection = z.object({
    db_path: z.string().default('./data/ai-agent.db'),
});

const ConfigSchema = z.object({
    daemon: DaemonSection.default({}),
    network: NetworkSection.default({}),
    tls: TlsSection,
    auth: AuthSection,
    database: DatabaseSection.default({}),
    vault: VaultSection.default({}),
    containerd: ContainerdSection,
    storage: StorageSection.default({}),
    applications: ApplicationsSection.default({
        installed: [
            "@orch/auth",
            "@orch/vault",
            "@orch/container",
            "@orch/process",
            "@orch/db-manager",
            "@orch/ai-agent",
            "@orch/mcp-server",
            "@orch/terminal",
            "@orch/media",
            "@orch/plugin-manager"
        ]
    }),
    terminal: TerminalSection.default({}),
    db_manager: DbManagerSection.default({}),
    ai_agent: AiAgentSection.default({}),
});

export type DaemonConfig = z.infer<typeof ConfigSchema>;

// ─── Type Compatibility Guard ─────────────────────────────────────────────────
// Compile error here means the Zod schema has drifted from OrchestratorConfig.
// Fix: update the Zod schema above OR the interfaces in @orch/shared/src/config.ts.
export type _AssertDaemonConfigSatisfiesContract = DaemonConfig extends OrchestratorConfig ? true
    : ['ERROR: DaemonConfig does not satisfy OrchestratorConfig — update the Zod schema'];

// ─── Environment Variable Overlay ────────────────────────────────────────────

/**
 * Overlay environment variables onto the parsed TOML config.
 * Format: ORCH_<SECTION>_<KEY> (e.g., ORCH_NETWORK_WS_PORT=9443)
 */
function applyEnvOverrides(config: Record<string, unknown>): Record<string, unknown> {
    const prefix = 'ORCH_';

    for (const [envKey, envValue] of Object.entries(process.env)) {
        if (!envKey.startsWith(prefix) || envValue === undefined) continue;

        const parts = envKey.slice(prefix.length).toLowerCase().split('_');
        if (parts.length < 2) continue;

        const section = parts[0]!;
        const key = parts.slice(1).join('_');

        // Create section if it doesn't exist
        if (typeof config[section] !== 'object' || config[section] === null) {
            (config as Record<string, unknown>)[section] = {};
        }

        const sectionObj = config[section] as Record<string, unknown>;

        // Type coercion: try to match the expected type
        const existing = sectionObj[key];
        if (typeof existing === 'number') {
            const num = Number(envValue);
            if (!isNaN(num)) {
                sectionObj[key] = num;
            }
        } else if (typeof existing === 'boolean') {
            sectionObj[key] = envValue === 'true' || envValue === '1';
        } else {
            sectionObj[key] = envValue;
        }
    }

    return config;
}

// ─── Config Loader ───────────────────────────────────────────────────────────

/**
 * Load and validate daemon configuration.
 *
 * @param configPath - Path to the TOML config file.
 * @returns Validated DaemonConfig.
 * @throws OrchestratorError if config is invalid or missing.
 */
export function loadConfig(configPath?: string): DaemonConfig {
    const resolvedPath = resolve(configPath ?? './config/config.toml');

    // Load TOML file
    let raw: Record<string, unknown>;
    if (existsSync(resolvedPath)) {
        try {
            const content = readFileSync(resolvedPath, 'utf-8');
            raw = parseTOML(content) as Record<string, unknown>;
        } catch (err) {
            throw new OrchestratorError(
                ErrorCode.CONFIG_INVALID,
                `Failed to parse config file: ${err instanceof Error ? err.message : String(err)}`,
                { path: resolvedPath },
            );
        }
    } else {
        throw new OrchestratorError(
            ErrorCode.CONFIG_NOT_FOUND,
            `Config file not found: ${resolvedPath}`,
            { path: resolvedPath },
        );
    }

    // Apply env overrides
    const withEnv = applyEnvOverrides(raw);

    // Validate with Zod
    const result = ConfigSchema.safeParse(withEnv);
    if (!result.success) {
        const issues = result.error.issues.map(
            (i) => `  - ${i.path.join('.')}: ${i.message}`,
        ).join('\n');

        throw new OrchestratorError(
            ErrorCode.CONFIG_INVALID,
            `Config validation failed:\n${issues}`,
            { path: resolvedPath, issues: result.error.issues },
        );
    }

    return result.data;
}
