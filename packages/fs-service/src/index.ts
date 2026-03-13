/**
 * @orch/fs-service — Filesystem service for the event-driven architecture.
 *
 * Provides sandboxed filesystem operations (read, write, list, stat, mkdir, remove)
 * over Redis pub/sub.
 */

export { FsServiceWorker } from './service.js';
export type { FsServiceConfig } from './service.js';
