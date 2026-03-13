/**
 * @orch/gateway — API Gateway for the vloop event-driven architecture.
 *
 * The gateway is the single public-facing entry point:
 *   ● JWT validation        ● Rate limiting
 *   ● RBAC policy check     ● Session registry
 *   ● WS connection hub     ● Request → Event
 *   ● Reply fan-out         ● Audit logging
 *
 * No service handles authentication — they trust the gateway to have
 * validated the JWT, checked RBAC, and enriched the event.
 */

// Server
export { createGateway } from './server.js';
export type { GatewayConfig, GatewayHandle, JwtVerifier } from './server.js';

// Redis
export { createRedisClient, createRedisClients, closeRedisClients } from './redis.js';
export type { RedisConfig, RedisClients } from './redis.js';

// Session Store
export { SessionStore } from './session-store.js';

// Service Registry
export { ServiceRegistry } from './service-registry.js';

// Event Bridge
export { EventBridge } from './event-bridge.js';
export type { ResultHandler } from './event-bridge.js';

// Middleware
export { checkPermission, RateLimiter } from './middleware.js';
