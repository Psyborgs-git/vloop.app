/**
 * Agent Orchestrator — core execution engine built on Google ADK.
 *
 * Supports:
 * - Legacy workflow execution (prompt + model string)
 * - Config-based agent chat (agentId + sessionId)
 * - Config-based workflow execution (workflowId + input)
 */

import type { Logger, HandlerContext } from "@orch/daemon";
import {
	LlmAgent,
	InMemoryRunner,
	LLMRegistry
} from "@google/adk";

import { ToolRegistry } from "./tools.js";
import { AgentSandbox } from "./sandbox.js";
import { ProviderRegistry } from "./config/provider-registry.js";
import { AgentBuilder } from "./config/agent-builder.js";
import { WorkflowRunner } from "./config/workflow-runner.js";
import { MemoryStore } from "./config/memory-store.js";
import { OllamaSync } from "./config/ollama-sync.js";
import { AnthropicLlm } from "./config/anthropic-llm.js";
import { OllamaLlm } from "./config/ollama-llm.js";
import { GoogleLlm } from "./config/google-llm.js";
import { OpenAILlm } from "./config/openai-llm.js";
import { KnowledgeGraphService } from "./config/knowledge-graph.js";
import { RAGService } from "./config/rag-service.js";
import { ContextManager } from "./config/context-manager.js";
import { McpClientManager } from "./mcp/client-manager.js";
import type { AIConfigStore } from "./config/store.js";
import type {
	AgentConfigId,
	ChatSessionId,
	WorkflowId,
	ModelId,
	ModelConfig,
	ProviderConfig,
} from "./config/types.js";
import type { ResolvedModel } from "./config/provider-registry.js";

/** Sanitize a string to be a valid ADK agent/app name (letters, digits, underscores). */
function sanitizeName(s: string): string {
	return s.replace(/[^a-zA-Z0-9_]/g, "_");
}

export interface AgentChatOptions {
	agentId: AgentConfigId;
	sessionId: ChatSessionId;
	prompt: string;
}

export class AgentOrchestrator {
	public readonly providerRegistry: ProviderRegistry;
	public readonly agentBuilder: AgentBuilder;
	public readonly workflowRunner: WorkflowRunner;
	public readonly memoryStore: MemoryStore;
	public readonly ollamaSync: OllamaSync;
	public readonly knowledgeGraph: KnowledgeGraphService;
	public readonly ragService: RAGService;
	public readonly contextManager: ContextManager;
	public readonly mcpClientManager: McpClientManager;

	constructor(
		public readonly tools: ToolRegistry,
		public readonly sandbox: AgentSandbox,
		private readonly logger: Logger,
		private readonly configStore?: AIConfigStore,
		private readonly vaultGet?: (ref: string) => Promise<string | undefined>,
	) {
		// Register custom LLMs with ADK
		LLMRegistry.register(AnthropicLlm);
		LLMRegistry.register(OllamaLlm);
		LLMRegistry.register(GoogleLlm);
		LLMRegistry.register(OpenAILlm);

		// Initialize config-based subsystems if store is available
		this.providerRegistry = new ProviderRegistry(configStore!, logger);
		this.mcpClientManager = new McpClientManager(logger);
		this.agentBuilder = new AgentBuilder(
			configStore!,
			this.providerRegistry,
			tools,
			this.mcpClientManager,
			logger,
		);
		this.workflowRunner = new WorkflowRunner(
			configStore!,
			this.agentBuilder,
			logger,
		);
		this.memoryStore = new MemoryStore(configStore!, logger);
		this.ollamaSync = new OllamaSync(configStore!, logger);
		this.knowledgeGraph = new KnowledgeGraphService(configStore!, logger);
		this.ragService = new RAGService(this.memoryStore, this.knowledgeGraph);
		this.contextManager = new ContextManager(this.ragService);
	}

	/**
	 * Config-based agent chat — resolves stored AgentConfig, runs against a persisted chat session.
	 */
	public async runAgentChat(
		opts: AgentChatOptions,
		emit?: (type: "stream" | "event", payload: unknown, seq?: number) => void,
		context?: HandlerContext,
	): Promise<any> {
		if (!this.configStore) throw new Error("AI config store not initialized");

		this.logger.info(
			{ agentId: opts.agentId, sessionId: opts.sessionId },
			"Starting agent chat",
		);

		// Persist user message
		const agentConfig = this.configStore.getAgent(opts.agentId);
		if (!agentConfig)
			throw new Error(`Agent config not found: ${opts.agentId}`);

		const resolvedRuntime = await this.providerRegistry.resolve(
			agentConfig.modelId,
			this.vaultGet,
			agentConfig.params,
		);

		this.configStore.createChatMessage({
			sessionId: opts.sessionId,
			role: "user",
			content: opts.prompt,
			providerType: resolvedRuntime.provider.type,
			modelId: resolvedRuntime.model.modelId,
		});

		// Inject memory + RAG + KG context
		const enrichedPrompt = this.contextManager.build({
			agentId: opts.agentId,
			userPrompt: opts.prompt,
			systemPrompt: agentConfig.systemPrompt,
		});

		const startedAt = Date.now();

		// Build ADK-native agent from config
		const built = await this.agentBuilder.build(
			opts.agentId,
			this.vaultGet,
			context,
		);

		const appName = sanitizeName(`chat_${opts.agentId}`);

		// Run using ADK
		const runner = new InMemoryRunner({
			agent: built.agent,
			appName,
		});

		const session = await runner.sessionService.createSession({
			appName,
			userId: "chat_user",
		});

		// ADK sessions rebuild from events; chat history is already in the DB
		// and memory context is injected above via enrichedPrompt

		let seq = 0;
		let fullText = "";
		const toolCalls: any[] = [];
		const toolResults: any[] = [];

		const events = runner.runAsync({
			userId: "chat_user",
			sessionId: session.id,
			newMessage: { role: "user", parts: [{ text: enrichedPrompt }] },
		});

		for await (const event of events) {
			const modelError = (event as any)?.errorMessage as string | undefined;
			const modelCode = (event as any)?.errorCode as string | undefined;
			if (modelError || modelCode) {
				throw new Error(
					modelError || `Model execution failed${modelCode ? ` (${modelCode})` : ""}`,
				);
			}

			const chunkToolCalls: any[] = [];
			const chunkToolResults: any[] = [];
			let chunkText = "";

			if (event.content?.parts) {
				for (const part of event.content.parts) {
					if ("text" in part && part.text) {
						chunkText += part.text;
						fullText += part.text;
					}
					if ("functionCall" in part) {
						chunkToolCalls.push(part.functionCall);
						toolCalls.push(part.functionCall);
					}
					if ("functionResponse" in part) {
						chunkToolResults.push(part.functionResponse);
						toolResults.push(part.functionResponse);
					}
				}
			}

			if (emit) {
                                const mappedEvent: any = { ...event };
                                if (chunkText) mappedEvent.text = chunkText;
                                if (chunkToolCalls.length > 0) mappedEvent.toolCalls = chunkToolCalls;
                                if (chunkToolResults.length > 0)
                                        mappedEvent.toolResult = chunkToolResults[0]; // ChatView expects single toolResult
                                if (event.actions?.requestedToolConfirmations && Object.keys(event.actions.requestedToolConfirmations).length > 0) {
                                        mappedEvent.requestedToolConfirmations = event.actions.requestedToolConfirmations;
                                }
                                if (event.longRunningToolIds && event.longRunningToolIds.length > 0) {
                                        mappedEvent.longRunningToolIds = event.longRunningToolIds;
                                }
                                emit("stream", mappedEvent, seq++);
                        }
		}

		// Persist assistant message
		const assistantMessage = this.configStore.createChatMessage({
			sessionId: opts.sessionId,
			role: "assistant",
			content: fullText,
			toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
			toolResults: toolResults.length > 0 ? toolResults : undefined,
			providerType: built.runtime.provider.type,
			modelId: built.runtime.model.modelId,
			latencyMs: Date.now() - startedAt,
			metadata: {
				adapter: built.runtime.adapter,
			},
		});

		// Log individual tool calls
		if (toolCalls.length > 0) {
			const toolCallInputs = toolCalls.map((call, i) => {
				const result = toolResults[i];
				return {
					sessionId: opts.sessionId,
					messageId: assistantMessage.id,
					toolName: call.name,
					arguments: JSON.stringify(call.args),
					result: result ? JSON.stringify(result.response) : undefined,
				};
			});
			this.configStore.createToolCalls(toolCallInputs);
		}

		this.memoryStore.ingestConversation({
			agentId: opts.agentId,
			sessionId: opts.sessionId,
			userPrompt: opts.prompt,
			assistantReply: fullText,
		});
		this.knowledgeGraph.indexText(
			opts.agentId,
			opts.sessionId,
			`${opts.prompt}\n${fullText}`,
		);

		return {
			status: "completed",
			model: built.modelString,
			result: fullText,
			toolCalls,
		};
	}

	/**
	 * Config-based workflow execution.
	 */
	public async runWorkflow(
		workflowId: WorkflowId,
		input: string,
		emit?: (type: "stream" | "event", payload: unknown, seq?: number) => void,
		context?: HandlerContext,
	): Promise<any> {
		return this.workflowRunner.run(
			workflowId,
			input,
			emit,
			this.vaultGet,
			context,
		);
	}

	/**
	 * Simple chat completion — direct model call without tools or agent config.
	 * This is the "chat" mode for plain LLM interactions.
	 */
	public async runChatCompletion(
		opts: {
			model?: string;
			modelId?: ModelId | string;
			prompt: string;
			systemPrompt?: string;
			sessionId?: ChatSessionId;
		},
		emit?: (type: "stream" | "event", payload: unknown, seq?: number) => void,
	): Promise<any> {
		const resolved = await this.resolveRuntimeForCompletion(opts);
		this.logger.info(
			{ model: resolved.model.modelId, adapter: resolved.adapter },
			"Starting chat completion",
		);

		if (opts.sessionId && this.configStore) {
			this.configStore.createChatMessage({
				sessionId: opts.sessionId,
				role: "user",
				content: opts.prompt,
				providerType: resolved.provider.type,
				modelId: resolved.model.modelId,
			});
		}

		const startedAt = Date.now();

		const agent = new LlmAgent({
			name: "chat_completion",
			model: resolved.modelString!,
			description: "Simple chat assistant.",
			instruction:
				opts.systemPrompt ||
				"You are a helpful AI assistant. Respond clearly and concisely.",
			tools: [],
			generateContentConfig: {
				temperature: resolved.params.temperature,
				maxOutputTokens:
					typeof resolved.params.maxTokens === "number"
						? resolved.params.maxTokens
						: undefined,
				topP:
					typeof resolved.params.topP === "number"
						? resolved.params.topP
						: undefined,
				stopSequences: Array.isArray(resolved.params.stop)
					? resolved.params.stop
					: undefined,
			},
		});

		const runner = new InMemoryRunner({ agent, appName: "chat_completion" });
		const session = await runner.sessionService.createSession({
			appName: "chat_completion",
			userId: "chat_user",
		});

		let seq = 0;
		let fullText = "";

		const events = runner.runAsync({
			userId: "chat_user",
			sessionId: session.id,
			newMessage: { role: "user", parts: [{ text: opts.prompt }] },
		});

		for await (const event of events) {
			const modelError = (event as any)?.errorMessage as string | undefined;
			const modelCode = (event as any)?.errorCode as string | undefined;
			if (modelError || modelCode) {
				throw new Error(
					modelError || `Model execution failed${modelCode ? ` (${modelCode})` : ""}`,
				);
			}

			let chunkText = "";
			if (event.content?.parts) {
				for (const part of event.content.parts) {
					if ("text" in part && part.text) {
						chunkText += part.text;
						fullText += part.text;
					}
				}
			}
			if (emit) {
				const mappedEvent: any = { ...event };
				if (chunkText) mappedEvent.text = chunkText;
				emit("stream", mappedEvent, seq++);
			}
		}

		if (opts.sessionId && this.configStore) {
			this.configStore.createChatMessage({
				sessionId: opts.sessionId,
				role: "assistant",
				content: fullText,
				providerType: resolved.provider.type,
				modelId: resolved.model.modelId,
				latencyMs: Date.now() - startedAt,
				metadata: { adapter: resolved.adapter },
			});
		}

		this.memoryStore.ingestConversation({
			sessionId: opts.sessionId,
			userPrompt: opts.prompt,
			assistantReply: fullText,
		});
		this.knowledgeGraph.indexText(
			undefined,
			opts.sessionId,
			`${opts.prompt}\n${fullText}`,
		);

		return {
			status: "completed",
			model: resolved.model.modelId,
			result: fullText,
		};
	}

	private async resolveRuntimeForCompletion(opts: {
		model?: string;
		modelId?: ModelId | string;
	}): Promise<ResolvedModel> {
		const ref = opts.modelId || opts.model;
		if (ref && this.configStore) {
			const byId = this.configStore.getModel(ref as ModelId);
			if (byId) {
				return this.providerRegistry.resolve(byId.id, this.vaultGet);
			}

			const byModelString = this.configStore
				.listModels()
				.find((m) => m.modelId === ref);
			if (byModelString) {
				return this.providerRegistry.resolve(byModelString.id, this.vaultGet);
			}
		}

		const fallbackModel = (opts.model || "gemini-2.5-flash").trim();
		const model: ModelConfig = {
			id: "adhoc-model" as ModelId,
			name: fallbackModel,
			providerId: "adhoc-provider" as any,
			modelId: fallbackModel,
			params: {},
			runtime: "chat",
			supportsStreaming: true,
			supportsTools: false,
			createdAt: new Date(0).toISOString(),
			updatedAt: new Date(0).toISOString(),
		};
		const provider: ProviderConfig = {
			id: "adhoc-provider" as any,
			name: "Adhoc Google",
			type: "google",
			adapter: "adk-native",
			createdAt: new Date(0).toISOString(),
			updatedAt: new Date(0).toISOString(),
		};

		return {
			adapter: "adk-native",
			modelString: fallbackModel,
			provider,
			model,
			params: {},
			headers: {},
			timeoutMs: 60_000,
		};
	}
}
