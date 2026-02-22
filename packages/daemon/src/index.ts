/**
 * @orch/daemon — Core daemon, WebSocket server, and message router.
 */

export { loadConfig } from './config.js';
export type { DaemonConfig } from './config.js';

export { Router } from './router.js';
export type { TopicHandler, Middleware, HandlerContext } from './router.js';

export type {
    Request, Response, ResponseType,
    RequestMeta, ResponseMeta,
} from './protocol.js';
export { parseRequest, serializeResponse } from './protocol.js';

export { createWebSocketServer } from './server.js';
export { createHealthServer } from './health.js';
export { createLogger } from './logging.js';
export type { Logger } from './logging.js';
export { setupSignalHandlers } from './signal.js';
export * from './service/index.js';
