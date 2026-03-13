/**
 * @orch/rbac — Centralised RBAC module.
 *
 * Provides the PolicyEngine (deny-wins model, glob matching)
 * and an optional Redis-backed RoleStore for hot-reloadable role management.
 */

export { PolicyEngine } from './engine.js';
export type { PolicyEngineConfig } from './engine.js';
export { RoleStore } from './store.js';
