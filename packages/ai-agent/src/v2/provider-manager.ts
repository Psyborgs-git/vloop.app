/**
 * ProviderManager — Singleton that resolves ModelId → ResolvedModel
 * with provider_db_id-keyed caching and secure key lifecycle.
 *
 * - Cache miss → load from ProviderRepo + ModelRepo, resolve vault key, cache.
 * - Raw API keys are held in memory only for the cache entry lifetime.
 * - invalidate(providerId) clears the relevant cache entries.
 */

import type { Logger } from '@orch/daemon';
import type { IProviderRepo } from './repos/interfaces.js';
import type { IModelRepo } from './repos/interfaces.js';
import type {
	ProviderId, ModelId, ModelParams,
	ProviderConfig, ModelConfig, ProviderAdapter, ResolvedModel,
} from './types.js';

export type VaultGetFn = (ref: string) => Promise<string | undefined>;

export class ProviderManager {
	private cache = new Map<string, ResolvedModel>();

	constructor(
		private readonly providerRepo: IProviderRepo,
		private readonly modelRepo: IModelRepo,
		private readonly vaultGet: VaultGetFn | undefined,
		private readonly logger: Logger,
	) {}

	/**
	 * Resolve a ModelId into everything needed for dstsx execution.
	 * Cached by `${providerId}::${modelId}`.
	 */
	async resolve(modelId: ModelId, runtimeParams?: ModelParams): Promise<ResolvedModel> {
		const model = this.modelRepo.get(modelId);
		if (!model) throw new Error(`Model config not found: ${modelId}`);

		const provider = this.providerRepo.get(model.providerId);
		if (!provider) throw new Error(`Provider config not found: ${model.providerId}`);

		const cacheKey = `${provider.id}::${model.id}`;
		const cached = this.cache.get(cacheKey);
		if (cached) {
			// Apply runtime param overrides on cache hit
			if (runtimeParams) {
				return { ...cached, params: { ...cached.params, ...runtimeParams } };
			}
			return cached;
		}

		let apiKey: string | undefined;
		if (provider.apiKeyRef && this.vaultGet) {
			apiKey = await this.vaultGet(provider.apiKeyRef);
		}

		const adapter = this.resolveAdapter(provider);
		const modelString = this.buildModelString(provider, model);
		const endpoint = this.resolveEndpoint(provider, adapter);
		const headers = {
			...this.normalizeHeaders(provider.headers),
			...this.authHeaders(provider, apiKey),
		};
		const timeoutMs = provider.timeoutMs || 60_000;
		const params: ModelParams = { ...(model.params || {}), ...(runtimeParams || {}) };

		const resolved: ResolvedModel = {
			adapter, modelString, provider, model,
			params, apiKey, endpoint, headers, timeoutMs,
		};

		this.cache.set(cacheKey, resolved);
		this.logger.debug({ provider: provider.type, adapter, model: model.modelId }, 'ProviderManager: resolved & cached');
		return resolved;
	}

	/** Invalidate all cache entries for a specific provider. */
	invalidate(providerId: ProviderId): void {
		for (const [key] of this.cache) {
			if (key.startsWith(`${providerId}::`)) {
				this.cache.delete(key);
			}
		}
	}

	/** Clear entire cache (e.g. on shutdown). */
	clearAll(): void {
		this.cache.clear();
	}

	// ── Private helpers (ported from ProviderRegistry) ───────────────────

	private resolveAdapter(provider: ProviderConfig): ProviderAdapter {
		if (provider.adapter) return provider.adapter as ProviderAdapter;
		switch (provider.type) {
			case 'anthropic': return 'anthropic';
			case 'ollama': return 'ollama';
			default: return 'adk-native';
		}
	}

	private buildModelString(provider: ProviderConfig, model: ModelConfig): string | undefined {
		return `vloop://${provider.type}/${model.id}`;
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
