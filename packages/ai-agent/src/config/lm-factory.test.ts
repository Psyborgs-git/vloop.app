/**
 * LM Factory tests — verifies createLM maps provider types correctly.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ResolvedModel } from '../v2/types.js';

// Mock @jaex/dstsx to inspect which adapter is instantiated
vi.mock('@jaex/dstsx', () => {
	class MockLM {
		model: string;
		opts: Record<string, unknown>;
		constructor(opts: Record<string, unknown> = {}) {
			this.model = (opts.model as string) ?? '';
			this.opts = opts;
		}
	}
	return {
		OpenAI: class extends MockLM { __type = 'OpenAI'; },
		Anthropic: class extends MockLM { __type = 'Anthropic'; },
		GoogleAI: class extends MockLM { __type = 'GoogleAI'; },
		Ollama: class extends MockLM { __type = 'Ollama'; },
	};
});

const { createLM } = await import('./lm-factory.js');

function makeResolved(overrides: Partial<ResolvedModel> = {}): ResolvedModel {
	return {
		adapter: 'adk-native',
		modelString: 'test-model',
		provider: {
			id: 'p1' as any,
			name: 'Test',
			type: 'openai',
			createdAt: '',
			updatedAt: '',
		},
		model: {
			id: 'm1' as any,
			name: 'test',
			providerId: 'p1' as any,
			modelId: 'gpt-4o',
			params: {},
			createdAt: '',
			updatedAt: '',
		},
		params: {},
		headers: {},
		timeoutMs: 60_000,
		...overrides,
	};
}

describe('createLM', () => {
	it('creates OpenAI adapter for openai provider', () => {
		const lm = createLM(makeResolved({ apiKey: 'sk-test' })) as any;
		expect(lm.__type).toBe('OpenAI');
		expect(lm.opts.apiKey).toBe('sk-test');
		expect(lm.opts.model).toBe('gpt-4o');
	});

	it('creates Anthropic adapter for anthropic provider', () => {
		const resolved = makeResolved({
			apiKey: 'ant-key',
			provider: { id: 'p1' as any, name: 'Anthropic', type: 'anthropic', createdAt: '', updatedAt: '' },
			model: { id: 'm1' as any, name: 'test', providerId: 'p1' as any, modelId: 'claude-3-5-haiku-latest', params: {}, createdAt: '', updatedAt: '' },
		});
		const lm = createLM(resolved) as any;
		expect(lm.__type).toBe('Anthropic');
		expect(lm.opts.model).toBe('claude-3-5-haiku-latest');
	});

	it('creates GoogleAI adapter for google provider', () => {
		const resolved = makeResolved({
			apiKey: 'google-key',
			provider: { id: 'p1' as any, name: 'Google', type: 'google', createdAt: '', updatedAt: '' },
			model: { id: 'm1' as any, name: 'test', providerId: 'p1' as any, modelId: 'gemini-2.5-flash', params: {}, createdAt: '', updatedAt: '' },
		});
		const lm = createLM(resolved) as any;
		expect(lm.__type).toBe('GoogleAI');
		expect(lm.opts.model).toBe('gemini-2.5-flash');
	});

	it('creates Ollama adapter for ollama provider', () => {
		const resolved = makeResolved({
			endpoint: 'http://localhost:11434',
			provider: { id: 'p1' as any, name: 'Ollama', type: 'ollama', createdAt: '', updatedAt: '' },
			model: { id: 'm1' as any, name: 'test', providerId: 'p1' as any, modelId: 'llama3.2:latest', params: {}, createdAt: '', updatedAt: '' },
		});
		const lm = createLM(resolved) as any;
		expect(lm.__type).toBe('Ollama');
		expect(lm.opts.baseURL).toBe('http://localhost:11434');
	});

	it('creates OpenAI adapter for groq provider', () => {
		const resolved = makeResolved({
			apiKey: 'groq-key',
			provider: { id: 'p1' as any, name: 'Groq', type: 'groq', createdAt: '', updatedAt: '' },
		});
		const lm = createLM(resolved) as any;
		expect(lm.__type).toBe('OpenAI');
	});

	it('falls back to header-based API key when apiKey is undefined', () => {
		const resolved = makeResolved({
			apiKey: undefined,
			headers: { Authorization: 'Bearer from-header' },
		});
		const lm = createLM(resolved) as any;
		expect(lm.__type).toBe('OpenAI');
		expect(lm.opts.apiKey).toBe('from-header');
	});
});
