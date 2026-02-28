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
	ChatMessage,
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
	toolIds?: string[];
	persistUserMessage?: boolean;
	historyMessages?: ChatMessage[];
}

interface ContextCompactionOptions {
	maxChars?: number;
	keepLastMessages?: number;
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
		private readonly configStore: AIConfigStore,
		private readonly vaultGet?: (ref: string) => Promise<string | undefined>,
	) {
		// Register custom LLMs with ADK
		LLMRegistry.register(AnthropicLlm);
		LLMRegistry.register(OllamaLlm);
		LLMRegistry.register(GoogleLlm);
		LLMRegistry.register(OpenAILlm);

		// Initialize config-based subsystems if store is available
		this.providerRegistry = new ProviderRegistry(configStore, logger);
		this.mcpClientManager = new McpClientManager(logger);
		this.agentBuilder = new AgentBuilder(
			configStore,
			this.providerRegistry,
			tools,
			this.mcpClientManager,
			logger,
		);
		this.workflowRunner = new WorkflowRunner(
			configStore,
			this.agentBuilder,
			logger,
		);
		this.memoryStore = new MemoryStore(configStore, logger);
		this.ollamaSync = new OllamaSync(configStore, logger);
		this.knowledgeGraph = new KnowledgeGraphService(configStore, logger);
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

		if (opts.persistUserMessage !== false) {
			this.configStore.createChatMessage({
				sessionId: opts.sessionId,
				role: "user",
				content: opts.prompt,
				providerType: resolvedRuntime.provider.type,
				modelId: resolvedRuntime.model.modelId,
			});
		}

		// Inject memory + RAG + KG context
		const enrichedPrompt = this.contextManager.build({
			agentId: opts.agentId,
			userPrompt: opts.prompt,
			systemPrompt: agentConfig.systemPrompt,
		});
		const historyMessages = opts.historyMessages ?? this.getSessionHistoryForPrompt(opts.sessionId, opts.prompt);
		const promptWithHistory = this.composePromptWithHistory(enrichedPrompt, historyMessages);

		const startedAt = Date.now();

		const sessionToolIds = this.configStore
			.getSessionTools(opts.sessionId)
			.map((t) => t.id as unknown as string);
		const effectiveToolIds = opts.toolIds ?? sessionToolIds;
		const sessionMcpServerIds = this.configStore
			.getSessionMcpServers(opts.sessionId)
			.map((s) => s.id);

		// Build ADK-native agent from config
		const built = await this.agentBuilder.build(
			opts.agentId,
			this.vaultGet,
			context,
			{
				toolIds: effectiveToolIds,
				mcpServerIds: sessionMcpServerIds,
			},
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
			newMessage: { role: "user", parts: [{ text: promptWithHistory }] },
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
				const callId = (call as any)?.id ?? (call as any)?.callId;
				const result =
					toolResults.find((candidate) => {
						const candidateId =
							(candidate as any)?.callId ??
							(candidate as any)?.id ??
							(candidate as any)?.toolCallId ??
							(candidate as any)?.tool_call_id;
						return Boolean(callId && candidateId && callId === candidateId);
					}) ?? toolResults[i];
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
			toolIds?: string[];
			persistUserMessage?: boolean;
			historyMessages?: ChatMessage[];
		},
		emit?: (type: "stream" | "event", payload: unknown, seq?: number) => void,
	): Promise<any> {
		const resolved = await this.resolveRuntimeForCompletion(opts);
		this.logger.info(
			{
				model: resolved.model.modelId,
				adapter: resolved.adapter,
				sessionId: opts.sessionId,
				toolCount:
					opts.toolIds?.length ??
					(opts.sessionId && this.configStore
						? this.configStore.getSessionTools(opts.sessionId).length
						: 0),
			},
			"Starting chat completion",
		);

		if (opts.sessionId && this.configStore && opts.persistUserMessage !== false) {
			this.configStore.createChatMessage({
				sessionId: opts.sessionId,
				role: "user",
				content: opts.prompt,
				providerType: resolved.provider.type,
				modelId: resolved.model.modelId,
			});
		}

		const startedAt = Date.now();

		const sessionToolIds = opts.sessionId && this.configStore
			? this.configStore
				.getSessionTools(opts.sessionId)
				.map((t) => t.id as unknown as string)
			: [];
		const sessionMcpServerIds = opts.sessionId && this.configStore
			? this.configStore.getSessionMcpServers(opts.sessionId).map((s) => s.id)
			: [];
		const effectiveToolIds = opts.toolIds ?? sessionToolIds;
		const tools = await this.agentBuilder.resolveFunctionTools(
			effectiveToolIds,
			sessionMcpServerIds,
		);

		const agent = new LlmAgent({
			name: "chat_completion",
			model: resolved.modelString!,
			description: "Simple chat assistant.",
			instruction:
				opts.systemPrompt ||
				"You are a helpful AI assistant. Respond clearly and concisely.",
			tools,
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
		const toolCalls: any[] = [];
		const toolResults: any[] = [];

		const events = runner.runAsync({
			userId: "chat_user",
			sessionId: session.id,
			newMessage: {
				role: "user",
				parts: [{
					text: this.composePromptWithHistory(
						opts.prompt,
						opts.historyMessages ?? this.getSessionHistoryForPrompt(opts.sessionId, opts.prompt),
					),
				}],
			},
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
				if (chunkToolCalls.length > 0)
					mappedEvent.toolCalls = chunkToolCalls;
				if (chunkToolResults.length > 0)
					mappedEvent.toolResult = chunkToolResults[0];
				if (
					event.actions?.requestedToolConfirmations &&
					Object.keys(event.actions.requestedToolConfirmations).length > 0
				) {
					mappedEvent.requestedToolConfirmations =
						event.actions.requestedToolConfirmations;
				}
				if (event.longRunningToolIds && event.longRunningToolIds.length > 0) {
					mappedEvent.longRunningToolIds = event.longRunningToolIds;
				}
				emit("stream", mappedEvent, seq++);
			}
		}

		if (opts.sessionId && this.configStore) {
			this.configStore.createChatMessage({
				sessionId: opts.sessionId,
				role: "assistant",
				content: fullText,
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
				toolResults: toolResults.length > 0 ? toolResults : undefined,
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
			toolCalls,
		};
	}

	public async rerunChatFromMessage(
		opts: {
			sessionId: ChatSessionId;
			messageId: string;
			toolIds?: string[];
		},
		emit?: (type: "stream" | "event", payload: unknown, seq?: number) => void,
		context?: HandlerContext,
	): Promise<any> {
		if (!this.configStore) throw new Error("AI config store not initialized");

		const session = this.configStore.getChatSession(opts.sessionId);
		if (!session) throw new Error(`Chat session not found: ${opts.sessionId}`);

		const allMessages = this.configStore.listChatMessages(opts.sessionId);
		const anchorIndex = allMessages.findIndex((m) => m.id === opts.messageId);
		if (anchorIndex < 0) {
			throw new Error(`Chat message not found in session: ${opts.messageId}`);
		}

		const anchor = allMessages[anchorIndex]!;
		const rerunUserIndex =
			anchor.role === "user"
				? anchorIndex
				: (() => {
					for (let i = anchorIndex; i >= 0; i--) {
						if (allMessages[i]?.role === "user") return i;
					}
					return -1;
				})();

		if (rerunUserIndex < 0) {
			throw new Error("Unable to rerun: no user prompt found before selected message");
		}

		const rerunUserMessage = allMessages[rerunUserIndex]!;
		const historyMessages = allMessages.slice(0, rerunUserIndex);

		this.configStore.deleteChatMessagesAfter(opts.sessionId, rerunUserMessage.id);

		if (session.agentId) {
			return this.runAgentChat(
				{
					agentId: session.agentId,
					sessionId: opts.sessionId,
					prompt: rerunUserMessage.content,
					toolIds: opts.toolIds,
					persistUserMessage: false,
					historyMessages,
				},
				emit,
				context,
			);
		}

		const modelRef =
			session.modelId ||
			rerunUserMessage.modelId ||
			allMessages
				.slice(0, rerunUserIndex + 1)
				.reverse()
				.find((m) => m.modelId)?.modelId;

		return this.runChatCompletion(
			{
				modelId: modelRef,
				prompt: rerunUserMessage.content,
				sessionId: opts.sessionId,
				toolIds: opts.toolIds,
				persistUserMessage: false,
				historyMessages,
			},
			emit,
		);
	}

	public forkChatFromMessage(opts: {
		sessionId: ChatSessionId;
		messageId: string;
		title?: string;
	}): { session: ReturnType<AIConfigStore["getChatSession"]> } {
		if (!this.configStore) throw new Error("AI config store not initialized");
		const session = this.configStore.forkChatSessionUpTo(
			opts.sessionId,
			opts.messageId as any,
			opts.title,
		);
		return { session };
	}

	public compactChatContext(opts: {
		sessionId: ChatSessionId;
		maxChars?: number;
		keepLastMessages?: number;
	}): {
		compacted: boolean;
		deletedMessages: number;
		summary?: string;
		totalMessages: number;
		remainingMessages: number;
	} {
		if (!this.configStore) throw new Error("AI config store not initialized");
		const session = this.configStore.getChatSession(opts.sessionId);
		if (!session) throw new Error(`Chat session not found: ${opts.sessionId}`);

		const allMessages = this.configStore.listChatMessages(opts.sessionId);
		const compacted = this.compactHistoryMessages(allMessages, {
			maxChars: opts.maxChars,
			keepLastMessages: opts.keepLastMessages,
		});

		if (!compacted.didCompact || compacted.recentMessages.length === 0) {
			return {
				compacted: false,
				deletedMessages: 0,
				totalMessages: allMessages.length,
				remainingMessages: allMessages.length,
			};
		}

		const firstRecent = compacted.recentMessages[0]!;
		const deleted = this.configStore.deleteChatMessagesBefore(opts.sessionId, firstRecent.id);
		this.configStore.createChatMessage({
			sessionId: opts.sessionId,
			role: "system",
			content: `Context was compacted to fit the model window.\n\n${compacted.summary}`,
			metadata: {
				contextCompaction: true,
				compactedAt: new Date().toISOString(),
				deletedMessages: deleted,
				keepLastMessages: compacted.keepLastMessages,
			},
		});

		return {
			compacted: true,
			deletedMessages: deleted,
			summary: compacted.summary,
			totalMessages: allMessages.length,
			remainingMessages: allMessages.length - deleted + 1,
		};
	}

	private composePromptWithHistory(
		latestPrompt: string,
		historyMessages?: ChatMessage[],
	): string {
		if (!historyMessages || historyMessages.length === 0) {
			return latestPrompt;
		}

		const compacted = this.compactHistoryMessages(historyMessages);
		const promptHistory = compacted.promptHistory;
		if (promptHistory.length === 0) return latestPrompt;

		const formattedHistory = promptHistory
			.filter((m) => ["system", "user", "assistant", "tool"].includes(m.role))
			.map((m) => {
				const roleLabel =
					m.role === "assistant"
						? "Assistant"
						: m.role === "user"
							? "User"
							: m.role === "system"
								? "System"
								: "Tool";
				return `${roleLabel}:\n${m.content}`;
			})
			.join("\n\n");

		return [
			"Conversation so far:",
			formattedHistory,
			"",
			compacted.didCompact
				? "Note: Earlier turns were compacted into a summary to fit context limits."
				: "",
			"",
			"Continue the conversation naturally and answer the latest user message below.",
			latestPrompt,
		].filter(Boolean).join("\n");
	}

	private getSessionHistoryForPrompt(
		sessionId?: ChatSessionId,
		latestPrompt?: string,
	): ChatMessage[] {
		if (!sessionId || !this.configStore) return [];
		const all = this.configStore.listChatMessages(sessionId);
		if (all.length === 0) return [];
		const maybeLast = all[all.length - 1];
		if (maybeLast?.role === "user" && latestPrompt && maybeLast.content === latestPrompt) {
			return all.slice(0, -1);
		}
		return all;
	}

	private compactHistoryMessages(
		historyMessages: ChatMessage[],
		opts?: ContextCompactionOptions,
	): {
		didCompact: boolean;
		summary: string;
		promptHistory: ChatMessage[];
		recentMessages: ChatMessage[];
		keepLastMessages: number;
	} {
		const maxChars = opts?.maxChars ?? 24_000;
		const keepLastMessages = opts?.keepLastMessages ?? 12;
		const totalChars = historyMessages.reduce((acc, m) => acc + (m.content?.length ?? 0), 0);

		if (totalChars <= maxChars || historyMessages.length <= keepLastMessages) {
			return {
				didCompact: false,
				summary: "",
				promptHistory: historyMessages,
				recentMessages: historyMessages,
				keepLastMessages,
			};
		}

		const splitIndex = Math.max(1, historyMessages.length - keepLastMessages);
		const older = historyMessages.slice(0, splitIndex);
		const recent = historyMessages.slice(splitIndex);
		const summary = this.summarizeMessages(older);

		const summaryMessage: ChatMessage = {
			id: "context-summary" as any,
			sessionId: recent[0]?.sessionId ?? ("context-summary" as any),
			role: "system",
			content: `Summary of earlier conversation:\n${summary}`,
			createdAt: new Date().toISOString(),
		};

		return {
			didCompact: true,
			summary,
			promptHistory: [summaryMessage, ...recent],
			recentMessages: recent,
			keepLastMessages,
		};
	}

	private summarizeMessages(messages: ChatMessage[]): string {
		const lines: string[] = [];
		for (const m of messages) {
			const role = m.role === "assistant" ? "Assistant" : m.role === "user" ? "User" : "System";
			const content = (m.content || "").replace(/\s+/g, " ").trim();
			if (!content) continue;
			const clipped = content.length > 280 ? `${content.slice(0, 277)}...` : content;
			lines.push(`- ${role}: ${clipped}`);
			if (lines.length >= 60) break;
		}
		if (lines.length === 0) {
			return "No significant earlier conversation content.";
		}
		const joined = lines.join("\n");
		return joined.length > 4_000 ? `${joined.slice(0, 3_997)}...` : joined;
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
