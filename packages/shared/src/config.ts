/**
 * Strongly-typed configuration contract for the Orchestrator system.
 *
 * This file defines the canonical TypeScript interfaces for every configuration
 * section. The Zod runtime schema in `@orch/daemon` validates incoming TOML/env
 * data against these contracts at startup.
 *
 * ─── Per-app namespace extension ─────────────────────────────────────────────
 *
 * Apps can add their own typed config namespace via TypeScript module
 * augmentation. The runtime Zod section and a default value must also be
 * registered with `extendConfigSchema` in `@orch/daemon` so the field appears
 * in the validated config object.
 *
 * @example
 * ```ts
 * // packages/my-app/src/config.ts
 * declare module '@orch/shared' {
 *   interface OrchestratorConfig {
 *     my_app: MyAppSectionConfig;
 *   }
 * }
 * export interface MyAppSectionConfig {
 *   feature_enabled: boolean;
 *   data_path: string;
 * }
 * ```
 */

import type { DependencyContainer } from 'tsyringe';
import { TOKENS } from './tokens.js';

// ─── Section Interfaces ───────────────────────────────────────────────────────

export interface DaemonSectionConfig {
    pid_file: string;
    log_level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
    foreground: boolean;
}

export interface NetworkSectionConfig {
    bind_address: string;
    ws_port: number;
    health_port: number;
    canvas_port: number;
    mcp_port: number;
    max_connections: number;
    ping_interval_secs: number;
    pong_timeout_secs: number;
    /** Maximum WebSocket message payload in bytes. Default: 1 MiB. */
    max_message_size_bytes: number;
}

export interface TlsSectionConfig {
    cert_path: string;
    key_path: string;
}

export interface AuthSectionConfig {
    jwt_public_key_path: string;
    jwt_algorithm: 'RS256' | 'ES256' | 'EdDSA';
    jwt_issuer: string;
    jwt_audience: string;
    session_idle_timeout_secs: number;
    session_max_lifetime_secs: number;
    max_sessions_per_identity: number;
}

export interface DatabaseSectionConfig {
    engine: 'sqlite' | 'mysql' | 'postgres';
    path: string;
    postgres_url?: string;
    mysql_url?: string;
}

export interface VaultSectionConfig {
    max_secret_versions: number;
    soft_delete_retention_days: number;
}

export interface ContainerdSectionConfig {
    socket_path: string;
    namespace: string;
}

export interface StorageSectionConfig {
    /** Root path for Canvas state files. */
    canvas_path: string;
}

export interface ApplicationsSectionConfig {
    installed: string[];
}

/** Config namespace owned by `@orch/terminal`. */
export interface TerminalSectionConfig {
    /** Directory where session transcripts are persisted. */
    log_path: string;
}

/** Config namespace owned by `@orch/db-manager`. */
export interface DbManagerSectionConfig {
    /** Root directory for provisioned workspace databases. */
    workspaces_path: string;
}

/** Config namespace owned by `@orch/ai-agent`. */
export interface AiAgentSectionConfig {
    /** Path to the dedicated AI-agent SQLite database file. */
    db_path: string;
}

// ─── Root Config Interface ────────────────────────────────────────────────────

/**
 * Strongly-typed contract for the full Orchestrator daemon configuration.
 *
 * All fields mirror the sections in `config/config.toml` and are validated at
 * startup by the Zod schema in `@orch/daemon`.
 *
 * Add per-app namespaces via TypeScript module augmentation (see file JSDoc
 * at the top of this file for a full example).
 */
export interface OrchestratorConfig {
    daemon: DaemonSectionConfig;
    network: NetworkSectionConfig;
    tls: TlsSectionConfig;
    auth: AuthSectionConfig;
    database: DatabaseSectionConfig;
    vault: VaultSectionConfig;
    /** Only required when the container subsystem is enabled. */
    containerd?: ContainerdSectionConfig;
    storage: StorageSectionConfig;
    applications: ApplicationsSectionConfig;
    terminal: TerminalSectionConfig;
    db_manager: DbManagerSectionConfig;
    ai_agent: AiAgentSectionConfig;
}

// ─── Config Resolution Helpers ────────────────────────────────────────────────

/**
 * Resolve the full typed config from the DI container.
 *
 * @example
 * ```ts
 * const cfg = resolveConfig(container);
 * cfg.network.ws_port; // number — fully typed
 * ```
 */
export function resolveConfig(container: DependencyContainer): OrchestratorConfig;

/**
 * Resolve a single named section from the config.
 *
 * @example
 * ```ts
 * const { session_idle_timeout_secs } = resolveConfig(container, 'auth');
 * ```
 */
export function resolveConfig<K extends keyof OrchestratorConfig>(
    container: DependencyContainer,
    namespace: K,
): OrchestratorConfig[K];

export function resolveConfig<K extends keyof OrchestratorConfig>(
    container: DependencyContainer,
    namespace?: K,
): OrchestratorConfig | OrchestratorConfig[K] {
    const cfg = container.resolve<OrchestratorConfig>(TOKENS.Config);
    return namespace === undefined ? cfg : cfg[namespace];
}
