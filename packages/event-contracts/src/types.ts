/**
 * TypeScript types for every event shape in the vloop architecture.
 *
 * These types are the shared contract between the gateway and all services.
 * They are validated at runtime using the corresponding Zod schemas in schemas.ts.
 */

// ─── Base ────────────────────────────────────────────────────────────────────

/** Fields present on every event flowing through Redis. */
export interface BaseEvent {
    /** Distributed trace identifier for observability. */
    traceId: string;
    /** ISO 8601 timestamp. */
    timestamp: string;
}

// ─── Inbound (Client → Gateway) ─────────────────────────────────────────────

/** Raw event received from the client over WebSocket, before RBAC enrichment. */
export interface InboundEvent extends BaseEvent {
    /** WebSocket session identifier. */
    sessionId: string;
    /** Target service name (terminal | ai | fs | vault). */
    service: string;
    /** Service-specific action (exec | chat | read | write …). */
    action: string;
    /** Action-specific payload. */
    payload: unknown;
}

// ─── Service Command (Gateway → Service via Redis) ──────────────────────────

/** RBAC-enriched event published to a service's command channel. */
export interface ServiceCommand extends BaseEvent {
    /** Authenticated user ID. */
    userId: string;
    /** Roles extracted from JWT / session. */
    roles: string[];
    /** Service-specific action. */
    action: string;
    /** Action-specific payload. Optional — services default to {} when absent. */
    payload?: unknown;
    /** Channel the service should publish results to. */
    replyTo: string;
}

// ─── Service Result (Service → Gateway via Redis) ───────────────────────────

/** Result event published by a service to its per-session reply channel. */
export interface ServiceResult extends BaseEvent {
    /** 'ok' or 'error'. */
    status: 'ok' | 'error';
    /** Streaming chunk (for stdout, tokens, etc.). */
    stream?: string;
    /** Final structured payload (on done:true or error). */
    payload?: unknown;
    /** True when the service has finished producing output. */
    done: boolean;
}

// ─── Audit ──────────────────────────────────────────────────────────────────

/** Entry written to the audit:stream Redis Stream via XADD. */
export interface AuditEntry extends BaseEvent {
    userId: string;
    action: string;
    service: string;
    /** Pipeline step (e.g., 'jwt_validated', 'rbac_checked', 'published'). */
    step: string;
}

// ─── Session (stored in Redis HSET) ─────────────────────────────────────────

/** Per-connection session metadata stored in ws:sessions:{connectionId}. */
export interface SessionInfo {
    userId: string;
    roles: string[];
    connectedAt: string;
}

// ─── Service Registry (stored in Redis HSET) ────────────────────────────────

/** Service discovery entry in service:registry. */
export interface ServiceRegistryEntry {
    serviceName: string;
    lastHeartbeat: string;
    channels: string[];
}

// ─── RBAC Model ─────────────────────────────────────────────────────────────

/** Role name — built-in roles plus extension-scoped roles. */
export type RoleName = 'guest' | 'developer' | 'admin' | `extension:${string}`;

/** A role's permission and deny lists. */
export interface RolePermissions {
    permissions: string[];
    deny: string[];
}

/** Default RBAC role definitions as specified in the target architecture. */
export const DEFAULT_ROLES: Record<string, RolePermissions> = {
    guest: {
        permissions: ['ai:chat'],
        deny: ['terminal:*', 'fs:write', 'vault:*'],
    },
    developer: {
        permissions: ['ai:*', 'terminal:exec', 'fs:read', 'fs:write'],
        deny: ['vault:admin'],
    },
    admin: {
        permissions: ['*'],
        deny: [],
    },
};
