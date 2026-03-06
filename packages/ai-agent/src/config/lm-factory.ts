/**
 * LM Factory — Creates @jaex/dstsx LM instances from ResolvedModel configs.
 *
 * Maps provider types (openai, anthropic, google, ollama, groq, custom) to
 * the appropriate dstsx adapter (OpenAI, Anthropic, GoogleAI, Ollama).
 */

import {
	OpenAI,
	Anthropic,
	GoogleAI,
	Ollama,
	type LM,
} from '@jaex/dstsx';
import type { ResolvedModel } from '../v2/types.js';

/**
 * Construct a @jaex/dstsx LM adapter from the resolved model configuration.
 */
export function createLM(resolved: ResolvedModel): LM {
	const providerType = resolved.provider.type;

	switch (providerType) {
		case 'anthropic':
			return new Anthropic({
				apiKey: resolved.apiKey ?? resolved.headers['x-api-key'],
				model: resolved.model.modelId,
			});

		case 'google':
			return new GoogleAI({
				apiKey: resolved.apiKey ?? resolved.headers['Authorization']?.replace('Bearer ', ''),
				model: resolved.model.modelId,
			});

		case 'ollama':
			return new Ollama({
				baseURL: resolved.endpoint ?? 'http://localhost:11434',
				model: resolved.model.modelId,
			});

		case 'openai':
		case 'groq':
		case 'custom':
		default:
			return new OpenAI({
				apiKey: resolved.apiKey ?? resolved.headers['Authorization']?.replace('Bearer ', ''),
				baseURL: resolved.endpoint,
				model: resolved.model.modelId,
			});
	}
}
