/**
 * @orch/vault — Encrypted secrets vault.
 */

export { vaultSchema, initVaultSchema } from './schema.js';
export { VaultCrypto } from './crypto.js';
export { VaultStore } from './store.js';
export { createVaultHandler } from './handler.js';
export { SecretInjector } from './inject.js';

// Event-driven service adapter
export { VaultServiceWorker } from './service.js';
export type { VaultServiceConfig } from './service.js';
