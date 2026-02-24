/**
 * Provider Registry — resolves stored ProviderConfig + ModelConfig into
 * an ADK-compatible model string.
 *
 * Google ADK natively supports Gemini models via "gemini-*" model strings.
 * For other providers, we store the connection configuration and resolve it
 * at runtime.
 */

import type { Logger } from '@orch/daemon';
import type { AIConfigStore } from './store.js';
import type { ModelConfig, ProviderConfig, ModelId, ModelParams, ProviderAdapter } from './types.js';

export interface ResolvedModel {
    /** Adapter mode for execution. */
    adapter: ProviderAdapter;
    /** The ADK model string (e.g. "gemini-2.5-flash") for adk-native runs. */
    modelString?: string;
    /** The fully resolved provider config. */
    provider: ProviderConfig;
    /** The fully resolved model config. */
    model: ModelConfig;
    /** Effective model params (model params overridden by runtime params). */
    params: ModelParams;
    /** API key resolved from vault (if applicable). */
    apiKey?: string;
    /** Normalized endpoint URL if relevant for adapter-based calls. */
    endpoint?: string;
    /** Normalized headers merged from provider settings. */
    headers: Record<string, string>;
    /** Request timeout in milliseconds. */
    timeoutMs: number;
}

export const activeRuntimes = new Map<string, ResolvedModel>();

export class ProviderRegistry {
    constructor(
        private readonly store: AIConfigStore,
        private readonly logger: Logger,
    ) { }

    /**
     * Resolves a ModelId from the config store into a model string + metadata.
     * For Gemini models, the ADK accepts the modelId directly (e.g. "gemini-2.5-flash").
     * For other providers, we construct a provider:model string.
     */
    async resolve(
        modelId: ModelId,
        vaultGet?: (ref: string) => Promise<string | undefined>,
        runtimeParams?: ModelParams,
    ): Promise<ResolvedModel> {
        const model = this.store.getModel(modelId);
        if (!model) throw new Error(`Model config not found: ${modelId}`);

        const provider = this.store.getProvider(model.providerId);
        if (!provider) throw new Error(`Provider config not found: ${model.providerId}`);

        let apiKey: string | undefined;
        if (provider.apiKeyRef && vaultGet) {
            apiKey = await vaultGet(provider.apiKeyRef);
        }

        const adapter = this.resolveAdapter(provider);
        const modelString = this.buildModelString(provider, model, adapter);
        const endpoint = this.resolveEndpoint(provider, adapter);
        const headers = {
            ...this.normalizeHeaders(provider.headers),
            ...this.authHeaders(provider, apiKey),
        };
        const timeoutMs = provider.timeoutMs ?? 60_000;
        const params = {
            ...(model.params || {}),
            ...(runtimeParams || {}),
        };

        this.logger.debug({ provider: provider.type, adapter, model: model.modelId }, 'Resolved model runtime config');

        const resolved = { adapter, modelString, provider, model, params, apiKey, endpoint, headers, timeoutMs };
        if (modelString) {
            activeRuntimes.set(modelString, resolved);
        }
        return resolved;
    }

    private resolveAdapter(_provider: ProviderConfig): ProviderAdapter {
        return 'adk-native'; // All models are now ADK native
    }

    private buildModelString(provider: ProviderConfig, model: ModelConfig, _adapter: ProviderAdapter): string | undefined {
        switch (provider.type) {
            case 'google':
                return model.modelId;
            case 'anthropic':
                return `anthropic-${model.modelId}`;
            case 'ollama':
                return `ollama-${model.modelId}`;
            default:
                return `${provider.type}-${model.modelId}`;
        }
    }

    private resolveEndpoint(provider: ProviderConfig, adapter: ProviderAdapter): string | undefined {
        if (adapter === 'anthropic') return provider.baseUrl || 'https://api.anthropic.com/v1/messages';
        if (adapter === 'ollama') return provider.baseUrl || 'http://localhost:11434';
        return provider.baseUrl;
    }

    private normalizeHeaders(headers?: Record<string, string>): Record<string, string> {
        if (!headers) return {};
        return Object.fromEntries(Object.entries(headers).filter(([, v]) => typeof v === 'string'));
    }

    private authHeaders(provider: ProviderConfig, apiKey?: string): Record<string, string> {
        if (!apiKey) return {};
        const authType = provider.authType ?? 'api-key';
        if (authType === 'bearer') return { Authorization: `Bearer ${apiKey}` };
        if (authType === 'none') return {};

        switch (provider.type) {
            case 'anthropic':
                return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
            case 'openai':
            case 'groq':
            case 'custom':
            case 'ollama':
            case 'google':
            default:
                return { Authorization: `Bearer ${apiKey}` };
        }
    }
}
