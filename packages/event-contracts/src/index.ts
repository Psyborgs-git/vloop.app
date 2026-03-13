/**
 * @orch/event-contracts — Shared event type definitions for the vloop architecture.
 *
 * Provides TypeScript types, Zod schemas, and Redis channel name constants
 * imported by the gateway and all services for contract enforcement.
 */

// Channel constants and helpers
export {
    CHANNELS,
    KEYS,
    SERVICES,
    resultChannel,
    wsSessionKey,
    serviceCommandChannel,
} from './channels.js';
export type { ServiceName } from './channels.js';

// Event types
export type {
    BaseEvent,
    InboundEvent,
    ServiceCommand,
    ServiceResult,
    AuditEntry,
    SessionInfo,
    ServiceRegistryEntry,
    RoleName,
    RolePermissions,
} from './types.js';
export { DEFAULT_ROLES } from './types.js';

// Zod schemas for runtime validation
export {
    BaseEventSchema,
    InboundEventSchema,
    ServiceCommandSchema,
    ServiceResultSchema,
    AuditEntrySchema,
    SessionInfoSchema,
    ServiceRegistryEntrySchema,
} from './schemas.js';

// Service worker base class
export { ServiceWorker } from './service-worker.js';
export type { ServiceWorkerConfig, RedisLike } from './service-worker.js';
