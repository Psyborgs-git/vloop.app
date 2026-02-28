import { BaseLlm, type LlmRequest, type LlmResponse, type BaseLlmConnection } from '@google/adk';
import type { Content, Part } from '@google/genai';
import { activeRuntimes, type ResolvedModel } from './provider-registry.js';

export class OpenAILlm extends BaseLlm {
    static readonly supportedModels = ['vloop://openai/.*', 'vloop://groq/.*', 'vloop://custom/.*'];
    private static readonly MAX_RETRY_ATTEMPTS = 3;

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
        const tools = this.mapTools(llmRequest.config?.tools);

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

        const res = await this.requestWithRetry(apiUrl, payload);

        if (!res.ok) {
            throw await this.mapHttpError(res, apiUrl);
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
                        if (event?.error) {
                            const msg =
                                typeof event.error?.message === 'string'
                                    ? event.error.message
                                    : 'OpenAI stream returned an error event';
                            throw this.toModelError('OPENAI_STREAM_ERROR', msg, {
                                endpoint: apiUrl,
                            });
                        }
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

    private mapTools(configTools?: any[]): any[] {
        if (!configTools) return [];
        const result: any[] = [];
        for (const toolGroup of configTools) {
            if (toolGroup.functionDeclarations) {
                for (const decl of toolGroup.functionDeclarations) {
                    result.push({
                        type: 'function',
                        function: {
                            name: decl.name,
                            description: decl.description,
                            parameters: decl.parameters || { type: 'object', properties: {} },
                        }
                    });
                }
            }
        }
        return result;
    }

    private mapResponse(json: any): LlmResponse {
        const choice = json?.choices?.[0];
        const message = choice?.message;
        if (!message || typeof message !== 'object') {
            throw new Error('OpenAI response missing choices[0].message');
        }
        const parts: Part[] = [];

        if (message.content) {
            parts.push({ text: message.content });
        }

        if (message.tool_calls) {
            for (const tc of message.tool_calls) {
                const thoughtSignature = this.resolveThoughtSignature(tc.function);
                parts.push({
                    functionCall: {
                        name: tc.function.name,
                        args: this.parseToolArguments(tc.function.arguments),
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
        const choice = event?.choices?.[0];
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

    private parseToolArguments(value: unknown): Record<string, unknown> {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return value as Record<string, unknown>;
        }
        if (typeof value !== 'string') return {};
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed as Record<string, unknown>
                : {};
        } catch {
            return {};
        }
    }

    private resolveThoughtSignature(source: unknown): string {
        const sig = (source as any)?.thought_signature ?? (source as any)?.thoughtSignature;
        if (typeof sig === 'string' && sig.trim().length > 0) {
            return sig;
        }

        const metadataSig = (this.runtime.provider.metadata as any)?.thoughtSignature;
        if (typeof metadataSig === 'string' && metadataSig.trim().length > 0) {
            return metadataSig;
        }

        return this.runtime.provider.type;
    }

    private async requestWithRetry(apiUrl: string, payload: unknown): Promise<Response> {
        let lastError: unknown;
        for (let attempt = 1; attempt <= OpenAILlm.MAX_RETRY_ATTEMPTS; attempt++) {
            try {
                const res = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...this.runtime.headers,
                    },
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(this.runtime.timeoutMs),
                });

                if (this.shouldRetryStatus(res.status) && attempt < OpenAILlm.MAX_RETRY_ATTEMPTS) {
                    await this.sleep(this.retryDelayMs(attempt));
                    continue;
                }
                return res;
            } catch (err: any) {
                lastError = err;
                if (!this.isRetryableNetworkError(err) || attempt >= OpenAILlm.MAX_RETRY_ATTEMPTS) {
                    const message =
                        err?.name === 'TimeoutError'
                            ? `OpenAI request timed out after ${this.runtime.timeoutMs}ms`
                            : `Failed to reach OpenAI endpoint at ${apiUrl}`;
                    throw this.toModelError('NETWORK_ERROR', message, {
                        endpoint: apiUrl,
                        cause: err?.message,
                    });
                }
                await this.sleep(this.retryDelayMs(attempt));
            }
        }

        throw this.toModelError('NETWORK_ERROR', 'OpenAI request failed after retries', {
            endpoint: apiUrl,
            cause: (lastError as any)?.message,
        });
    }

    private async mapHttpError(res: Response, apiUrl: string): Promise<Error> {
        const raw = await res.text();
        const parsed = this.tryParseJson(raw);
        const modelMsg =
            typeof parsed?.error?.message === 'string'
                ? parsed.error.message
                : typeof parsed?.message === 'string'
                ? parsed.message
                : undefined;

        if (res.status === 401 || res.status === 403) {
            return this.toModelError(
                'AUTH_ERROR',
                modelMsg || 'Unauthorized OpenAI request. Check configured API key/auth headers.',
                { status: res.status, endpoint: apiUrl },
            );
        }

        if (res.status === 429) {
            return this.toModelError('RATE_LIMIT', modelMsg || 'OpenAI rate limit exceeded', {
                status: res.status,
                endpoint: apiUrl,
            });
        }

        return this.toModelError(
            'OPENAI_HTTP_ERROR',
            modelMsg || `OpenAI request failed with status ${res.status}`,
            { status: res.status, endpoint: apiUrl, body: raw.slice(0, 500) },
        );
    }

    private shouldRetryStatus(status: number): boolean {
        return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
    }

    private isRetryableNetworkError(err: unknown): boolean {
        const name = (err as any)?.name;
        return name === 'TimeoutError' || name === 'AbortError' || name === 'TypeError';
    }

    private retryDelayMs(attempt: number): number {
        return Math.min(1500, 150 * 2 ** (attempt - 1));
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private tryParseJson(value: string): any | null {
        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }

    private toModelError(
        code: string,
        message: string,
        details?: Record<string, unknown>,
    ): Error {
        return new Error(
            JSON.stringify({
                error: {
                    code,
                    message,
                    ...(details ? { details } : {}),
                },
            }),
        );
    }
}