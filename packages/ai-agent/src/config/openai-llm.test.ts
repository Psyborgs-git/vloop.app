import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenAILlm } from './openai-llm.js';
import { activeRuntimes } from './provider-registry.js';

describe('OpenAILlm', () => {
    const model = 'vloop://openai/test-model';

    beforeEach(() => {
        activeRuntimes.set(model, {
            adapter: 'adk-native',
            modelString: model,
            provider: {
                id: 'provider-1' as any,
                name: 'OpenAI',
                type: 'openai',
                metadata: {},
                createdAt: new Date(0).toISOString(),
                updatedAt: new Date(0).toISOString(),
            },
            model: {
                id: 'model-1' as any,
                name: 'test',
                providerId: 'provider-1' as any,
                modelId: 'gpt-4o-mini',
                params: {},
                createdAt: new Date(0).toISOString(),
                updatedAt: new Date(0).toISOString(),
            },
            params: {},
            endpoint: 'https://example.invalid/v1',
            headers: {},
            timeoutMs: 1000,
        } as any);
    });

    afterEach(() => {
        activeRuntimes.delete(model);
        vi.restoreAllMocks();
    });

    it('falls back to provider type for thoughtSignature when missing', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({
                choices: [
                    {
                        message: {
                            tool_calls: [
                                {
                                    function: {
                                        name: 'lookup',
                                        arguments: '{"q":"hello"}',
                                    },
                                },
                            ],
                        },
                        finish_reason: 'tool_calls',
                    },
                ],
            }),
        } as any);

        const llm = new OpenAILlm({ model });
        const events = llm.generateContentAsync({
            contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
            config: {},
        } as any, false);

        const first = await events.next();
        expect(first.done).toBe(false);

        const toolCall = first.value?.content?.parts?.[0]?.functionCall as any;
        expect(toolCall?.thoughtSignature).toBe('openai');
    });

    it('throws a clear error when choices[0].message is missing', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ choices: [] }),
        } as any);

        const llm = new OpenAILlm({ model });

        await expect(async () => {
            for await (const _event of llm.generateContentAsync({
                contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
                config: {},
            } as any, false)) {
                // no-op
            }
        }).rejects.toThrow(/choices\[0\]\.message/);
    });

    it('maps 401 responses to AUTH_ERROR model payload', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: false,
            status: 401,
            text: async () => JSON.stringify({ error: { message: 'invalid key' } }),
        } as any);

        const llm = new OpenAILlm({ model });
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
                    choices: [
                        {
                            message: { content: 'ok' },
                            finish_reason: 'stop',
                        },
                    ],
                }),
            } as any);

        const llm = new OpenAILlm({ model });
        const events = llm.generateContentAsync({
            contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
            config: {},
        } as any, false);

        const first = await events.next();
        expect(first.done).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
