import { BaseLlm, type LlmRequest, type LlmResponse, type BaseLlmConnection } from '@google/adk';
import type { Content, Part } from '@google/genai';
import { activeRuntimes, type ResolvedModel } from './provider-registry.js';

export class OpenAILlm extends BaseLlm {
    static readonly supportedModels = ['vloop://openai/.*', 'vloop://groq/.*', 'vloop://custom/.*'];

    private runtime: ResolvedModel;

    constructor(params: { model: string }) {
        super({ model: params.model });
        const runtime = activeRuntimes.get(params.model);
        if (!runtime) {
            throw new Error(`OpenAILlm requires a ResolvedModel runtime for ${params.model}`);
        }
        this.runtime = runtime;
    }

    async *generateContentAsync(llmRequest: LlmRequest, stream?: boolean): AsyncGenerator<LlmResponse, void> {
        if (!this.runtime.endpoint) throw new Error('OpenAI endpoint is not configured');

        const normalizedBase = this.runtime.endpoint.endsWith('/') ? this.runtime.endpoint.slice(0, -1) : this.runtime.endpoint;
        const apiUrl = `${normalizedBase}/chat/completions`;

        const messages = this.mapMessages(llmRequest.contents);
        const tools = this.mapTools(llmRequest.toolsDict);

        const payload: any = {
            model: this.runtime.model.modelId,
            messages,
            max_tokens: this.runtime.params.maxTokens,
            temperature: this.runtime.params.temperature,
            top_p: this.runtime.params.topP,
            stop: this.runtime.params.stop,
            stream: !!stream,
        };

        if (tools.length > 0) {
            payload.tools = tools;
        }

        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.runtime.headers,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(this.runtime.timeoutMs),
        });

        if (!res.ok) {
            const body = await res.text();
            throw new Error(`OpenAI request failed (${res.status}): ${body}`);
        }

        if (!stream) {
            const json = await res.json() as any;
            yield this.mapResponse(json);
            return;
        }

        // Streaming implementation
        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;
                    try {
                        const event = JSON.parse(data);
                        const mapped = this.mapStreamEvent(event);
                        if (mapped) yield mapped;
                    } catch {
                        // Ignore parse errors for incomplete chunks
                    }
                }
            }
        }
    }

    async connect(_llmRequest: LlmRequest): Promise<BaseLlmConnection> {
        throw new Error('Live connection not supported for OpenAI');
    }

    private mapMessages(contents: Content[]): any[] {
        const messages: any[] = [];
        for (const c of contents) {
            const role = c.role === 'model' ? 'assistant' : c.role === 'user' ? 'user' : 'system';
            
            if (c.parts && c.parts.length > 0) {
                // Handle tool calls and results
                const toolCalls = c.parts.filter(p => p.functionCall).map(p => ({
                    id: crypto.randomUUID(), // ADK doesn't provide IDs, generate one
                    type: 'function',
                    function: {
                        name: p.functionCall!.name,
                        arguments: JSON.stringify(p.functionCall!.args),
                    }
                }));

                const toolResults = c.parts.filter(p => p.functionResponse).map(p => ({
                    role: 'tool',
                    tool_call_id: (p.functionResponse as any).id || 'unknown',
                    content: JSON.stringify(p.functionResponse!.response),
                }));

                const textParts = c.parts.filter(p => p.text).map(p => p.text).join('\n');

                if (toolResults.length > 0) {
                    messages.push(...toolResults);
                } else if (toolCalls.length > 0) {
                    messages.push({ role, content: textParts || null, tool_calls: toolCalls });
                } else if (textParts) {
                    messages.push({ role, content: textParts });
                }
            }
        }
        return messages;
    }

    private mapTools(toolsDict: Record<string, any>): any[] {
        return Object.values(toolsDict).map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters || { type: 'object', properties: {} },
            }
        }));
    }

    private mapResponse(json: any): LlmResponse {
        const choice = json.choices[0];
        const message = choice.message;
        const parts: Part[] = [];

        if (message.content) {
            parts.push({ text: message.content });
        }

        if (message.tool_calls) {
            for (const tc of message.tool_calls) {
                const thoughtSignature =
                    tc.function?.thought_signature ??
                    tc.function?.thoughtSignature ??
                    'openai';
                parts.push({
                    functionCall: {
                        name: tc.function.name,
                        args: JSON.parse(tc.function.arguments),
                        thoughtSignature,
                    } as any
                });
            }
        }

        return {
            content: { role: 'model', parts },
            finishReason: (choice.finish_reason === 'stop' ? 'STOP' : choice.finish_reason === 'tool_calls' ? 'STOP' : 'OTHER') as any,
            turnComplete: true,
        };
    }

    private mapStreamEvent(event: any): LlmResponse | null {
        const choice = event.choices[0];
        if (!choice) return null;

        const delta = choice.delta;
        if (delta.content) {
            return {
                content: { role: 'model', parts: [{ text: delta.content }] },
                partial: true,
            };
        }

        if (choice.finish_reason) {
            return {
                finishReason: (choice.finish_reason === 'stop' ? 'STOP' : 'OTHER') as any,
                turnComplete: true,
            };
        }

        // Tool use streaming is more complex, simplified here
        return null;
    }
}