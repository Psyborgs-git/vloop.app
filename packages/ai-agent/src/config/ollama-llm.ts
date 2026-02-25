import {
	BaseLlm,
	type LlmRequest,
	type LlmResponse,
	type BaseLlmConnection,
} from "@google/adk";
import type { Content, Part } from "@google/genai";
import { activeRuntimes, type ResolvedModel } from "./provider-registry.js";

export class OllamaLlm extends BaseLlm {
	static readonly supportedModels = ["vloop://ollama/.*"];

	private runtime: ResolvedModel;

	constructor(params: { model: string }) {
		super({ model: params.model });
		const runtime = activeRuntimes.get(params.model);
		if (!runtime) {
			throw new Error(
				`OllamaLlm requires a ResolvedModel runtime for ${params.model}`,
			);
		}
		this.runtime = runtime;
	}

	async *generateContentAsync(
		llmRequest: LlmRequest,
		stream?: boolean,
	): AsyncGenerator<LlmResponse, void> {
		if (!this.runtime.endpoint) {
			throw this.toModelError(
				"CONFIG_ERROR",
				"Ollama endpoint is not configured",
			);
		}

		const normalizedBase = this.runtime.endpoint.endsWith("/")
			? this.runtime.endpoint.slice(0, -1)
			: this.runtime.endpoint;
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
				{ role: "system", content: systemPrompt },
				...payload.messages,
			];
		}

		if (tools.length > 0) {
			payload.tools = tools;
		}

		let res: Response;
		try {
			res = await fetch(apiUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...this.runtime.headers,
				},
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(this.runtime.timeoutMs),
			});
		} catch (err: any) {
			const message = err?.name === "TimeoutError"
				? `Ollama request timed out after ${this.runtime.timeoutMs}ms`
				: `Failed to reach Ollama endpoint at ${apiUrl}`;
			throw this.toModelError("NETWORK_ERROR", message, {
				cause: err?.message,
				endpoint: apiUrl,
			});
		}

		if (!res.ok) {
			const raw = await res.text();
			const parsed = this.tryParseJson(raw);
			const ollamaError =
				typeof parsed?.error === "string"
					? parsed.error
					: undefined;

			if (res.status === 401 || res.status === 403) {
				throw this.toModelError(
					"AUTH_ERROR",
					ollamaError ||
						"Unauthorized Ollama request. If this is a remote Ollama server/model, configure provider authentication (apiKeyRef/authType) or a valid Authorization header.",
					{ status: res.status, endpoint: apiUrl },
				);
			}

			throw this.toModelError(
				"OLLAMA_HTTP_ERROR",
				ollamaError || `Ollama request failed with status ${res.status}`,
				{ status: res.status, endpoint: apiUrl, body: raw.slice(0, 500) },
			);
		}

		if (!stream) {
			const raw = await res.text();
			const json = this.tryParseJson(raw);
			if (!json) {
				throw this.toModelError(
					"INVALID_RESPONSE",
					"Ollama returned a non-JSON response for /api/chat",
					{ endpoint: apiUrl, body: raw.slice(0, 500) },
				);
			}
			if (typeof json.error === "string") {
				throw this.toModelError("OLLAMA_MODEL_ERROR", json.error, {
					endpoint: apiUrl,
				});
			}
			yield this.mapResponse(json);
			return;
		}

		// Streaming implementation
		const reader = res.body?.getReader();
		if (!reader) throw new Error("No response body");

		const decoder = new TextDecoder();
		let buffer = "";

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";

			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const event = JSON.parse(line);
					if (typeof event?.error === "string") {
						throw this.toModelError(
							"OLLAMA_STREAM_ERROR",
							event.error,
							{ endpoint: apiUrl },
						);
					}
					const mapped = this.mapStreamEvent(event);
					if (mapped) yield mapped;
				} catch (err) {
					// Ignore parse errors for incomplete chunks
					// this.runtime.logger.warn({ err }, "Failed to parse Ollama streaming event");
					if (err instanceof Error && err.message.startsWith('{"error"')) {
						throw err;
					}
				}
			}
		}

		if (buffer.trim()) {
			const event = this.tryParseJson(buffer.trim());
			if (event && typeof event.error === "string") {
				throw this.toModelError("OLLAMA_STREAM_ERROR", event.error, {
					endpoint: apiUrl,
				});
			}
		}
	}

	async connect(_llmRequest: LlmRequest): Promise<BaseLlmConnection> {
		throw new Error("Live connection not supported for Ollama");
	}

	private mapMessages(contents: Content[]): any[] {
		const messages: any[] = [];
		for (const c of contents) {
			if (c.role === "system") continue; // Handled separately

			const role =
				c.role === "model" ? "assistant" : c.role === "user" ? "user" : "user";

			let text = "";
			const tool_calls: any[] = [];

			for (const p of c.parts || []) {
				if (p.text) {
					text += p.text;
				} else if (p.functionCall) {
					tool_calls.push({
						function: {
							name: p.functionCall.name,
							arguments: p.functionCall.args,
						},
					});
				} else if (p.functionResponse) {
					// Ollama handles tool results as 'tool' role messages
					messages.push({
						role: "tool",
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
		return Object.values(toolsDict).map((t) => ({
			type: "function",
			function: {
				name: t.name,
				description: t.description,
				parameters: t.parameters || { type: "object", properties: {} },
			},
		}));
	}

	private extractSystemPrompt(contents: Content[]): string | undefined {
		const systemContents = contents.filter((c) => c.role === "system");
		if (systemContents.length === 0) return undefined;
		return systemContents
			.map((c) => c.parts?.map((p) => p.text).join("\n"))
			.join("\n");
	}

	private mapResponse(json: any): LlmResponse {
		const parts: Part[] = [];
		if (json.message?.content) {
			parts.push({ text: json.message.content });
		}
		for (const tc of json.message?.tool_calls || []) {
			parts.push(this.toFunctionCallPart(tc));
		}

		return {
			content: { role: "model", parts },
			finishReason: (json.done_reason === "stop" ? "STOP" : "OTHER") as any,
			turnComplete: true,
		};
	}

	private mapStreamEvent(event: any): LlmResponse | null {
		if (Array.isArray(event.message?.tool_calls) && event.message.tool_calls.length > 0) {
			const parts = event.message.tool_calls.map((tc: any) => this.toFunctionCallPart(tc));
			return {
				content: { role: "model", parts },
				partial: true,
			};
		}

		if (event.message?.content) {
			return {
				content: { role: "model", parts: [{ text: event.message.content }] },
				partial: true,
			};
		}
		if (event.done) {
			return {
				finishReason: (event.done_reason === "stop" ? "STOP" : "OTHER") as any,
				turnComplete: true,
			};
		}
		return null;
	}

	private toFunctionCallPart(tc: any): Part {
		const rawArgs = tc?.function?.arguments;
		let parsedArgs: Record<string, unknown> = {};

		if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
			parsedArgs = rawArgs as Record<string, unknown>;
		} else if (typeof rawArgs === "string") {
			const parsed = this.tryParseJson(rawArgs);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				parsedArgs = parsed as Record<string, unknown>;
			}
		}

		const thoughtSignature =
			tc?.function?.thought_signature ??
			tc?.function?.thoughtSignature ??
			"ollama";

		return {
			functionCall: {
				name: tc?.function?.name,
				args: parsedArgs,
				// ADK expects this field for function call parts on some runtimes.
				thoughtSignature,
			} as any,
		} as Part;
	}

	private tryParseJson(value: string): any | null {
		try {
			return JSON.parse(value);
		} catch {
			return null;
		}
	}

	/**
	 * ADK's LlmAgent currently expects model errors as JSON encoded in Error.message.
	 * Shape expected by ADK: { error: { code, message, ... } }
	 */
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
