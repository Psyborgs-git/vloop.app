import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnthropicLlm } from './anthropic-llm.js';
import { activeRuntimes } from './provider-registry.js';

describe('AnthropicLlm', () => {
    const model = 'vloop://anthropic/test-model';

    beforeEach(() => {
        activeRuntimes.set(model, {
            adapter: 'adk-native',
            modelString: model,
            provider: {
                id: 'provider-1' as any,
                name: 'Anthropic',
                type: 'anthropic',
                metadata: {},
                createdAt: new Date(0).toISOString(),
                updatedAt: new Date(0).toISOString(),
            },
            model: {
                id: 'model-1' as any,
                name: 'test',
                providerId: 'provider-1' as any,
                modelId: 'claude-3-5-haiku-latest',
                params: {},
                createdAt: new Date(0).toISOString(),
                updatedAt: new Date(0).toISOString(),
            },
            params: {},
            endpoint: 'https://example.invalid/v1/messages',
            headers: {},
            timeoutMs: 1000,
        } as any);
    });

    afterEach(() => {
        activeRuntimes.delete(model);
        vi.restoreAllMocks();
    });

    it('maps 401 responses to AUTH_ERROR model payload', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: false,
            status: 401,
            text: async () => JSON.stringify({ error: { message: 'invalid auth' } }),
        } as any);

        const llm = new AnthropicLlm({ model });
        await expect(async () => {
            for await (const _event of llm.generateContentAsync({
                contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
                config: {},
            } as any, false)) {
                // no-op
            }
        }).rejects.toThrow(/AUTH_ERROR/);
    });

    it('retries transient 5xx failures and eventually succeeds', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch');
        fetchMock
            .mockResolvedValueOnce({
                ok: false,
                status: 500,
                text: async () => JSON.stringify({ error: { message: 'upstream error' } }),
            } as any)
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    content: [{ type: 'text', text: 'ok' }],
                    stop_reason: 'end_turn',
                }),
            } as any);

        const llm = new AnthropicLlm({ model });
        const events = llm.generateContentAsync({
            contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
            config: {},
        } as any, false);

        const first = await events.next();
        expect(first.done).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('emits functionCall with thought signature aliases for tool_use blocks', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({
                content: [
                    {
                        type: 'tool_use',
                        name: 'lookup',
                        input: { q: 'hello' },
                    },
                ],
                stop_reason: 'tool_use',
            }),
        } as any);

        const llm = new AnthropicLlm({ model });
        const events = llm.generateContentAsync({
            contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
            config: {},
        } as any, false);

        const first = await events.next();
        expect(first.done).toBe(false);

        const toolCall = first.value?.content?.parts?.[0]?.functionCall as any;
        expect(toolCall?.thoughtSignature).toBe('anthropic');
        expect(toolCall?.thought_signature).toBe('anthropic');
        expect((first.value?.content?.parts?.[0] as any)?.thoughtSignature).toBe('anthropic');
        expect((first.value?.content?.parts?.[0] as any)?.thought_signature).toBe('anthropic');
    });
});
