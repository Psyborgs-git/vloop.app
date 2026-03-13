/**
 * Redis channel name constants — single source of truth.
 *
 * Convention:
 *   Command channels : {service}:{action}              e.g. terminal:commands
 *   Result channels  : {service}:results:{sessionId}   per-connection streams
 *   System channels  : service:registry, audit:stream
 */

// ─── Command Channels ────────────────────────────────────────────────────────

/** Command channels — gateway publishes, services subscribe. */
export const CHANNELS = {
    /** All client → server events before routing. */
    GATEWAY_INBOUND: 'gateway:inbound',

    /** Terminal service command channel. */
    TERMINAL_COMMANDS: 'terminal:commands',

    /** AI service request channel. */
    AI_REQUESTS: 'ai:requests',

    /** Filesystem service operation channel. */
    FS_OPS: 'fs:ops',

    /** Vault service operation channel. */
    VAULT_OPS: 'vault:ops',

    /** Redis Stream for audit events (XADD). */
    AUDIT_STREAM: 'audit:stream',
} as const;

// ─── Redis Key Prefixes ─────────────────────────────────────────────────────

/** Redis key prefixes for structured data. */
export const KEYS = {
    /** HSET per WebSocket connection: ws:sessions:{connectionId}. */
    WS_SESSIONS: 'ws:sessions',

    /** HSET for service discovery: service:registry. */
    SERVICE_REGISTRY: 'service:registry',
} as const;

// ─── Service Names ──────────────────────────────────────────────────────────

/** Canonical service names that match channel prefixes. */
export const SERVICES = {
    TERMINAL: 'terminal',
    AI: 'ai',
    FS: 'fs',
    VAULT: 'vault',
} as const;

export type ServiceName = (typeof SERVICES)[keyof typeof SERVICES];

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a per-session result channel.
 * Services publish results here; the gateway subscribes on behalf of the client.
 *
 * @example resultChannel('terminal', 'ws_xyz') → 'terminal:results:ws_xyz'
 */
export function resultChannel(service: string, sessionId: string): string {
    return `${service}:results:${sessionId}`;
}

/**
 * Build a Redis key for a WebSocket session.
 *
 * @example wsSessionKey('conn_abc') → 'ws:sessions:conn_abc'
 */
export function wsSessionKey(connectionId: string): string {
    return `${KEYS.WS_SESSIONS}:${connectionId}`;
}

/**
 * Map a service name to its command channel.
 */
export function serviceCommandChannel(service: ServiceName): string {
    const map: Record<ServiceName, string> = {
        terminal: CHANNELS.TERMINAL_COMMANDS,
        ai: CHANNELS.AI_REQUESTS,
        fs: CHANNELS.FS_OPS,
        vault: CHANNELS.VAULT_OPS,
    };
    return map[service];
}
