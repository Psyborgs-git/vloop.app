import { BaseLlm, type LlmRequest, type LlmResponse, type BaseLlmConnection } from '@google/adk';
import type { Content, Part } from '@google/genai';
import { activeRuntimes, type ResolvedModel } from './provider-registry.js';

export class OllamaLlm extends BaseLlm {
    static readonly supportedModels = ['ollama-.*'];

    private runtime: ResolvedModel;

    constructor(params: { model: string }) {
        super({ model: params.model });
        const runtime = activeRuntimes.get(params.model);
        if (!runtime) {
            throw new Error(`OllamaLlm requires a ResolvedModel runtime for ${params.model}`);
        }
        this.runtime = runtime;
    }

    async *generateContentAsync(llmRequest: LlmRequest, stream?: boolean): AsyncGenerator<LlmResponse, void> {
        if (!this.runtime.endpoint) throw new Error('Ollama endpoint is not configured');

        const normalizedBase = this.runtime.endpoint.endsWith('/') ? this.runtime.endpoint.slice(0, -1) : this.runtime.endpoint;
        const apiUrl = `${normalizedBase}/api/chat`;

        const messages = this.mapMessages(llmRequest.contents);
        const tools = this.mapTools(llmRequest.toolsDict);
        const systemPrompt = this.extractSystemPrompt(llmRequest.contents);

        const payload: any = {
            model: this.runtime.model.modelId,
            messages,
            stream: !!stream,
            options: {
                temperature: this.runtime.params.temperature,
                top_p: this.runtime.params.topP,
                top_k: this.runtime.params.topK,
                stop: this.runtime.params.stop,
            },
        };

        if (systemPrompt) {
            payload.messages = [
                { role: 'system', content: systemPrompt },
                ...payload.messages,
            ];
        }

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
            throw new Error(`Ollama request failed (${res.status}): ${body}`);
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
                if (!line.trim()) continue;
                try {
                    const event = JSON.parse(line);
                    const mapped = this.mapStreamEvent(event);
                    if (mapped) yield mapped;
                } catch {
                    // Ignore parse errors for incomplete chunks
                }
            }
        }
    }

    async connect(_llmRequest: LlmRequest): Promise<BaseLlmConnection> {
        throw new Error('Live connection not supported for Ollama');
    }

    private mapMessages(contents: Content[]): any[] {
        const messages: any[] = [];
        for (const c of contents) {
            if (c.role === 'system') continue; // Handled separately
            
            const role = c.role === 'model' ? 'assistant' : c.role === 'user' ? 'user' : 'user';
            
            let text = '';
            const tool_calls: any[] = [];

            for (const p of c.parts || []) {
                if (p.text) {
                    text += p.text;
                } else if (p.functionCall) {
                    tool_calls.push({
                        function: {
                            name: p.functionCall.name,
                            arguments: p.functionCall.args,
                        }
                    });
                } else if (p.functionResponse) {
                    // Ollama handles tool results as 'tool' role messages
                    messages.push({
                        role: 'tool',
                        content: JSON.stringify(p.functionResponse.response),
                    });
                }
            }

            if (text || tool_calls.length > 0) {
                const msg: any = { role, content: text };
                if (tool_calls.length > 0) {
                    msg.tool_calls = tool_calls;
                }
                messages.push(msg);
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

    private extractSystemPrompt(contents: Content[]): string | undefined {
        const systemContents = contents.filter(c => c.role === 'system');
        if (systemContents.length === 0) return undefined;
        return systemContents.map(c => c.parts?.map(p => p.text).join('\n')).join('\n');
    }

    private mapResponse(json: any): LlmResponse {
        const parts: Part[] = [];
        if (json.message?.content) {
            parts.push({ text: json.message.content });
        }
        for (const tc of json.message?.tool_calls || []) {
            parts.push({
                functionCall: {
                    name: tc.function.name,
                    args: tc.function.arguments,
                }
            });
        }

        return {
            content: { role: 'model', parts },
            finishReason: (json.done_reason === 'stop' ? 'STOP' : 'OTHER') as any,
            turnComplete: true,
        };
    }

    private mapStreamEvent(event: any): LlmResponse | null {
        if (event.message?.content) {
            return {
                content: { role: 'model', parts: [{ text: event.message.content }] },
                partial: true,
            };
        }
        if (event.done) {
            return {
                finishReason: (event.done_reason === 'stop' ? 'STOP' : 'OTHER') as any,
                turnComplete: true,
            };
        }
        return null;
    }
}
