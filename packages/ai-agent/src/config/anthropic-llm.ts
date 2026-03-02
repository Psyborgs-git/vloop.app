import { BaseLlm, type LlmRequest, type LlmResponse, type BaseLlmConnection } from '@google/adk';
import type { Content, Part } from '@google/genai';
import { activeRuntimes, type ResolvedModel } from './provider-registry.js';

export class AnthropicLlm extends BaseLlm {
    static readonly supportedModels = ['vloop://anthropic/.*'];
    private static readonly MAX_RETRY_ATTEMPTS = 3;

    private runtime: ResolvedModel;

    constructor(params: { model: string }) {
        super({ model: params.model });
        const runtime = activeRuntimes.get(params.model);
        if (!runtime) {
            throw new Error(`AnthropicLlm requires a ResolvedModel runtime for ${params.model}`);
        }
        this.runtime = runtime;
    }

    async *generateContentAsync(llmRequest: LlmRequest, stream?: boolean): AsyncGenerator<LlmResponse, void> {
        if (!this.runtime.endpoint) throw new Error('Anthropic endpoint is not configured');

        const messages = this.mapMessages(llmRequest.contents);
        const tools = this.mapTools(llmRequest.config?.tools);
        const systemPrompt = this.extractSystemPrompt(llmRequest.contents);

        const payload: any = {
            model: this.runtime.model.modelId,
            messages,
            max_tokens: this.runtime.params.maxTokens || 1024,
            temperature: this.runtime.params.temperature,
            top_p: this.runtime.params.topP,
            top_k: this.runtime.params.topK,
            stop_sequences: this.runtime.params.stop,
            stream: !!stream,
        };

        if (systemPrompt) {
            payload.system = systemPrompt;
        }

        if (tools.length > 0) {
            payload.tools = tools;
        }

        const res = await this.requestWithRetry(payload);

        if (!res.ok) {
            throw await this.mapHttpError(res);
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
                        if (event?.type === 'error') {
                            const msg =
                                typeof event?.error?.message === 'string'
                                    ? event.error.message
                                    : 'Anthropic stream returned an error event';
                            throw this.toModelError('ANTHROPIC_STREAM_ERROR', msg, {
                                endpoint: this.runtime.endpoint,
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
        throw new Error('Live connection not supported for Anthropic');
    }

    private mapMessages(contents: Content[]): any[] {
        const messages: any[] = [];
        for (const c of contents) {
            if (c.role === 'system') continue; // Handled separately
            
            const role = c.role === 'model' ? 'assistant' : c.role === 'user' ? 'user' : 'user';
            const content: any[] = [];

            for (const p of c.parts || []) {
                if (p.text) {
                    content.push({ type: 'text', text: p.text });
                } else if (p.functionCall) {
                    content.push({
                        type: 'tool_use',
                        id: crypto.randomUUID(), // ADK doesn't provide IDs, generate one
                        name: p.functionCall.name,
                        input: p.functionCall.args,
                    });
                } else if (p.functionResponse) {
                    content.push({
                        type: 'tool_result',
                        tool_use_id: (p.functionResponse as any).id || 'unknown', // Need ID mapping
                        content: JSON.stringify(p.functionResponse.response),
                    });
                }
            }

            if (content.length > 0) {
                messages.push({ role, content });
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
                        name: decl.name,
                        description: decl.description,
                        input_schema: decl.parameters || { type: 'object', properties: {} },
                    });
                }
            }
        }
        return result;
    }

    private extractSystemPrompt(contents: Content[]): string | undefined {
        const systemContents = contents.filter(c => c.role === 'system');
        if (systemContents.length === 0) return undefined;
        return systemContents.map(c => c.parts?.map(p => p.text).join('\n')).join('\n');
    }

    private mapResponse(json: any): LlmResponse {
        const parts: Part[] = [];
        for (const c of json.content || []) {
            if (c.type === 'text') {
                parts.push({ text: c.text });
            } else if (c.type === 'tool_use') {
                const thoughtSignature = this.resolveThoughtSignature(c);
                parts.push({
                    functionCall: {
                        name: c.name,
                        args: c.input,
                        thoughtSignature,
                        thought_signature: thoughtSignature,
                    } as any
                });
            }
        }

        return {
            content: { role: 'model', parts },
            finishReason: (json.stop_reason === 'end_turn' ? 'STOP' : json.stop_reason === 'tool_use' ? 'STOP' : 'OTHER') as any,
            turnComplete: true,
        };
    }

    private mapStreamEvent(event: any): LlmResponse | null {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            return {
                content: { role: 'model', parts: [{ text: event.delta.text }] },
                partial: true,
            };
        }
        if (event.type === 'message_delta' && event.delta?.stop_reason) {
            return {
                finishReason: (event.delta.stop_reason === 'end_turn' ? 'STOP' : 'OTHER') as any,
                turnComplete: true,
            };
        }
        // Tool use streaming is more complex, simplified here
        return null;
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

    private async requestWithRetry(payload: unknown): Promise<Response> {
        const endpoint = this.runtime.endpoint;
        if (!endpoint) {
            throw this.toModelError('CONFIG_ERROR', 'Anthropic endpoint is not configured');
        }
        let lastError: unknown;
        for (let attempt = 1; attempt <= AnthropicLlm.MAX_RETRY_ATTEMPTS; attempt++) {
            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'anthropic-version': '2023-06-01',
                        ...this.runtime.headers,
                    },
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(this.runtime.timeoutMs),
                });

                if (this.shouldRetryStatus(res.status) && attempt < AnthropicLlm.MAX_RETRY_ATTEMPTS) {
                    await this.sleep(this.retryDelayMs(attempt));
                    continue;
                }

                return res;
            } catch (err: any) {
                lastError = err;
                if (!this.isRetryableNetworkError(err) || attempt >= AnthropicLlm.MAX_RETRY_ATTEMPTS) {
                    const message =
                        err?.name === 'TimeoutError'
                            ? `Anthropic request timed out after ${this.runtime.timeoutMs}ms`
                            : `Failed to reach Anthropic endpoint at ${endpoint}`;
                    throw this.toModelError('NETWORK_ERROR', message, {
                        endpoint,
                        cause: err?.message,
                    });
                }
                await this.sleep(this.retryDelayMs(attempt));
            }
        }

        throw this.toModelError('NETWORK_ERROR', 'Anthropic request failed after retries', {
            endpoint,
            cause: (lastError as any)?.message,
        });
    }

    private async mapHttpError(res: Response): Promise<Error> {
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
                modelMsg || 'Unauthorized Anthropic request. Check configured API key/auth headers.',
                { status: res.status, endpoint: this.runtime.endpoint },
            );
        }

        if (res.status === 429) {
            return this.toModelError('RATE_LIMIT', modelMsg || 'Anthropic rate limit exceeded', {
                status: res.status,
                endpoint: this.runtime.endpoint,
            });
        }

        return this.toModelError(
            'ANTHROPIC_HTTP_ERROR',
            modelMsg || `Anthropic request failed with status ${res.status}`,
            { status: res.status, endpoint: this.runtime.endpoint, body: raw.slice(0, 500) },
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
