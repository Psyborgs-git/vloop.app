/**
 * Ollama Sync — auto-detect local Ollama, create/update provider, sync models.
 *
 * Ollama API:
 *   GET http://localhost:11434/        → "Ollama is running"
 *   GET http://localhost:11434/api/tags → { models: [{ name, model, size, ... }] }
 */

import type { Logger } from '@orch/daemon';
import type { AIConfigStore } from './store.js';
import type { ProviderId, ProviderConfig } from './types.js';

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

/** Result of a sync operation. */
export interface OllamaSyncResult {
    available: boolean;
    providerCreated: boolean;
    providerId: string | null;
    modelsAdded: string[];
    modelsRemoved: string[];
    modelsUnchanged: string[];
    totalLocalModels: number;
    error?: string;
}

/** Shape of a model object from Ollama's /api/tags endpoint. */
interface OllamaModel {
    name: string;
    model: string;
    size: number;
    digest: string;
    modified_at: string;
    details?: {
        parent_model?: string;
        format?: string;
        family?: string;
        families?: string[];
        parameter_size?: string;
        quantization_level?: string;
    };
}

export class OllamaSync {
    constructor(
        private readonly store: AIConfigStore,
        private readonly logger: Logger,
    ) { }

    /**
     * Full sync: check availability → ensure provider → sync models.
     */
    async sync(baseUrl?: string): Promise<OllamaSyncResult> {
        const url = baseUrl || DEFAULT_OLLAMA_URL;

        // 1. Check if Ollama is running
        const available = await this.isAvailable(url);
        if (!available) {
            this.logger.info({ url }, 'Ollama not available');
            return {
                available: false,
                providerCreated: false,
                providerId: null,
                modelsAdded: [],
                modelsRemoved: [],
                modelsUnchanged: [],
                totalLocalModels: 0,
            };
        }

        // 2. Ensure ollama provider exists
        const { provider, created } = this.ensureProvider(url);
        this.logger.info({ providerId: provider.id, created }, 'Ollama provider ensured');

        // 3. Fetch local models
        const localModels = await this.fetchModels(url);
        this.logger.info({ count: localModels.length }, 'Fetched Ollama models');

        // 4. Sync model configs
        const syncResult = this.syncModels(provider.id, localModels);

        return {
            available: true,
            providerCreated: created,
            providerId: provider.id,
            totalLocalModels: localModels.length,
            ...syncResult,
        };
    }

    /**
     * Check if Ollama is running at the given URL.
     */
    async isAvailable(baseUrl?: string): Promise<boolean> {
        const url = baseUrl || DEFAULT_OLLAMA_URL;
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000);
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);
            const text = await res.text();
            return text.toLowerCase().includes('ollama');
        } catch {
            return false;
        }
    }

    /**
     * Fetch available models from Ollama's /api/tags endpoint.
     */
    async fetchModels(baseUrl?: string): Promise<OllamaModel[]> {
        const url = baseUrl || DEFAULT_OLLAMA_URL;
        try {
            const res = await fetch(`${url}/api/tags`);
            if (!res.ok) return [];
            const data = await res.json() as { models?: OllamaModel[] };
            return data.models ?? [];
        } catch (e: any) {
            this.logger.warn({ err: e.message }, 'Failed to fetch Ollama models');
            return [];
        }
    }

    /**
     * Ensure an "ollama" type provider exists in the store.
     * Returns existing or creates a new one.
     */
    private ensureProvider(baseUrl: string): { provider: ProviderConfig; created: boolean } {
        const existing = this.store.listProviders().find(
            p => p.type === 'ollama' && (p.baseUrl === baseUrl || (!p.baseUrl && baseUrl === DEFAULT_OLLAMA_URL)),
        );

        if (existing) {
            return { provider: existing, created: false };
        }

        const provider = this.store.createProvider({
            name: 'Ollama (Local)',
            type: 'ollama',
            baseUrl,
            metadata: { autoSynced: true, syncedAt: new Date().toISOString() },
        });

        return { provider, created: true };
    }

    /**
     * Sync local Ollama models with the model config store.
     * - Adds new models that are locally available but not yet in the store.
     * - Removes models that are in the store but no longer locally available.
     * - Leaves unchanged models alone.
     */
    private syncModels(
        providerId: ProviderId,
        localModels: OllamaModel[],
    ): { modelsAdded: string[]; modelsRemoved: string[]; modelsUnchanged: string[] } {
        const existingModels = this.store.listModels().filter(m => m.providerId === providerId);
        const existingByModelId = new Map(existingModels.map(m => [m.modelId, m]));
        const localByName = new Map(localModels.map(m => [m.name, m]));

        const modelsAdded: string[] = [];
        const modelsRemoved: string[] = [];
        const modelsUnchanged: string[] = [];

        // Add new models
        for (const [name, ollama] of localByName) {
            if (!existingByModelId.has(name)) {
                const displayName = this.formatDisplayName(ollama);
                this.store.createModel({
                    name: displayName,
                    providerId,
                    modelId: name,
                    params: {
                        size: ollama.size,
                        family: ollama.details?.family,
                        parameterSize: ollama.details?.parameter_size,
                        quantization: ollama.details?.quantization_level,
                    },
                });
                modelsAdded.push(name);
                this.logger.info({ modelId: name, displayName }, 'Added Ollama model');
            } else {
                // Update metadata on existing model
                const existing = existingByModelId.get(name)!;
                this.store.updateModel(existing.id, {
                    params: {
                        size: ollama.size,
                        family: ollama.details?.family,
                        parameterSize: ollama.details?.parameter_size,
                        quantization: ollama.details?.quantization_level,
                    },
                });
                modelsUnchanged.push(name);
            }
        }

        // Remove models no longer available locally
        for (const [modelId, existing] of existingByModelId) {
            if (!localByName.has(modelId)) {
                try {
                    this.store.deleteModel(existing.id);
                    modelsRemoved.push(modelId);
                    this.logger.info({ modelId }, 'Removed stale Ollama model');
                } catch (e: any) {
                    // Model may still be referenced by agents/sessions (FK constraint).
                    // Keep it in config and continue syncing other models.
                    modelsUnchanged.push(modelId);
                    this.logger.warn(
                        { modelId, err: e?.message ?? String(e) },
                        'Skipped removing stale Ollama model because it is still referenced',
                    );
                }
            }
        }

        return { modelsAdded, modelsRemoved, modelsUnchanged };
    }

    /**
     * Format a human-readable display name from an Ollama model.
     * e.g. "llama3.2:3b" → "Llama 3.2 (3B)"
     */
    private formatDisplayName(model: OllamaModel): string {
        const parts = model.name.split(':');
        const baseName = parts[0] || model.name;
        const tag = parts[1];

        // Capitalize and clean up name
        let display = baseName
            .replace(/([a-z])(\d)/g, '$1 $2') // llama3 → llama 3
            .replace(/^./, c => c.toUpperCase()); // capitalize first

        if (tag) {
            display += ` (${tag.toUpperCase()})`;
        }

        if (model.details?.parameter_size) {
            display += ` — ${model.details.parameter_size}`;
        }

        return display;
    }
}
