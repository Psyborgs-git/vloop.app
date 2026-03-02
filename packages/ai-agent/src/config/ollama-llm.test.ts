import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OllamaLlm } from './ollama-llm.js';
import { activeRuntimes } from './provider-registry.js';

describe('OllamaLlm', () => {
    const model = 'vloop://ollama/test-model';

    beforeEach(() => {
        activeRuntimes.set(model, {
            adapter: 'ollama',
            modelString: model,
            provider: {
                id: 'provider-1' as any,
                name: 'Ollama',
                type: 'ollama',
                metadata: {},
                createdAt: new Date(0).toISOString(),
                updatedAt: new Date(0).toISOString(),
            },
            model: {
                id: 'model-1' as any,
                name: 'test',
                providerId: 'provider-1' as any,
                modelId: 'llama3.2:latest',
                params: {},
                createdAt: new Date(0).toISOString(),
                updatedAt: new Date(0).toISOString(),
            },
            params: {},
            endpoint: 'http://localhost:11434',
            headers: {},
            timeoutMs: 1000,
        } as any);
    });

    afterEach(() => {
        activeRuntimes.delete(model);
        vi.restoreAllMocks();
    });

    it('emits functionCall with both thoughtSignature and thought_signature', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify({
                message: {
                    content: '',
                    tool_calls: [
                        {
                            function: {
                                name: 'lookup',
                                arguments: '{"q":"hello"}',
                            },
                        },
                    ],
                },
                done_reason: 'stop',
            }),
        } as any);

        const llm = new OllamaLlm({ model });
        const events = llm.generateContentAsync({
            contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
            config: {},
        } as any, false);

        const first = await events.next();
        expect(first.done).toBe(false);

        const toolCall = first.value?.content?.parts?.[0]?.functionCall as any;
        expect(toolCall?.thoughtSignature).toBe('ollama');
        expect(toolCall?.thought_signature).toBe('ollama');
    });
});
