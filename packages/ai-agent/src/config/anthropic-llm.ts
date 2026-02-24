import { BaseLlm, type LlmRequest, type LlmResponse, type BaseLlmConnection } from '@google/adk';
import type { Content, Part } from '@google/genai';
import { activeRuntimes, type ResolvedModel } from './provider-registry.js';

export class AnthropicLlm extends BaseLlm {
    static readonly supportedModels = ['anthropic-.*'];

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
        const tools = this.mapTools(llmRequest.toolsDict);
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

        const res = await fetch(this.runtime.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'anthropic-version': '2023-06-01',
                ...this.runtime.headers,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(this.runtime.timeoutMs),
        });

        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Anthropic request failed (${res.status}): ${body}`);
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

    private mapTools(toolsDict: Record<string, any>): any[] {
        return Object.values(toolsDict).map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters || { type: 'object', properties: {} },
        }));
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
                parts.push({
                    functionCall: {
                        name: c.name,
                        args: c.input,
                    }
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
}
