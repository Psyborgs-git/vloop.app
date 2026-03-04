/**
 * Agent Orchestrator v2 — core execution engine built on Google ADK.
 *
 * Uses:
 * - Drizzle repos for all persistence (no AIConfigStore dependency)
 * - ProviderManager for cached model resolution
 * - MCPManager for dynamic MCP tool injection
 * - StateAdapter for DAG-based execution tracking
 * - WorkerDispatcher for durable worker-thread execution
 * - DAG-native branching (fork = new child, rerun = new branch)
 */

import type { Logger, HandlerContext } from "@orch/daemon";
import {
	LlmAgent,
	InMemoryRunner,
	LLMRegistry,
	FunctionTool,
	// Runner
} from "@google/adk";

import { ToolRegistry } from "../tools.js";
import { AgentSandbox } from "../sandbox.js";
import { AnthropicLlm } from "../config/anthropic-llm.js";
import { OllamaLlm } from "../config/ollama-llm.js";
import { GoogleLlm } from "../config/google-llm.js";
import { OpenAILlm } from "../config/openai-llm.js";

import { ProviderManager } from "./provider-manager.js";
import { MCPManager } from "./mcp-manager.js";
import { StateAdapter } from "./state-adapter.js";
import { WorkerDispatcher } from "./worker/dispatcher.js";
import type { StreamEmitter } from "./worker/dispatcher.js";

import type {
	IProviderRepo,
	IModelRepo,
	IToolRepo,
	IMcpServerRepo,
	IAgentRepo,
	IWorkflowRepo,
	ISessionRepo,
	IMessageRepo,
	IStateNodeRepo,
	IExecutionRepo,
	IWorkerRunRepo,
	IHitlWaitRepo,
	IAuditEventRepo,
	IMemoryRepo,
} from "./repos/interfaces.js";
import type { CanvasRepo } from "./repos/canvas-repo.js";

import type {
	AgentConfigId,
	SessionId,
	MessageId,
	WorkflowId,
	ModelId,
	CreateMessageInput,
	ProviderConfig,
	ModelConfig,
	ResolvedModel,
	Message,
} from "./types.js";

function sanitizeName(s: string): string {
	return s.replace(/[^a-zA-Z0-9_]/g, "_");
}

export interface AgentChatOptions {
	agentId: AgentConfigId;
	sessionId: SessionId;
	prompt: string;
	toolIds?: string[];
	persistUserMessage?: boolean;
	historyMessages?: Message[];
}

export interface OrchestratorRepos {
	provider: IProviderRepo;
	model: IModelRepo;
	tool: IToolRepo;
	mcpServer: IMcpServerRepo;
	agent: IAgentRepo;
	workflow: IWorkflowRepo;
	session: ISessionRepo;
	message: IMessageRepo;
	stateNode: IStateNodeRepo;
	execution: IExecutionRepo;
	workerRun: IWorkerRunRepo;
	hitlWait: IHitlWaitRepo;
	auditEvent: IAuditEventRepo;
	memory: IMemoryRepo;
	canvas: CanvasRepo;
}

export class AgentOrchestratorV2 {
	public readonly providerManager: ProviderManager;
	public readonly mcpManager: MCPManager;
	public readonly workerDispatcher: WorkerDispatcher;
	public readonly repos: OrchestratorRepos;

	// Run once at class-load time — prevents ADK "Updating LLM class" spam
	// that occurs when the constructor is called multiple times.
	static {
		LLMRegistry.register(AnthropicLlm);
		LLMRegistry.register(OllamaLlm);
		LLMRegistry.register(GoogleLlm);
		LLMRegistry.register(OpenAILlm);
	}

	constructor(
		public readonly tools: ToolRegistry,
		public readonly sandbox: AgentSandbox,
		private readonly logger: Logger,
		repos: OrchestratorRepos,
		_vaultGet?: (ref: string) => Promise<string | undefined>,
		dbPath?: string,
		dbPassphrase?: string,
	) {
		this.repos = repos;
		this.providerManager = new ProviderManager(
			repos.provider,
			repos.model,
			_vaultGet,
			logger,
		);
		this.mcpManager = new MCPManager(repos.mcpServer, logger);
		this.workerDispatcher = new WorkerDispatcher(
			repos.execution,
			repos.workerRun,
			repos.auditEvent,
			logger,
			dbPath ?? "",
			dbPassphrase ?? "",
		);
	}

	/**
	 * Config-based agent chat — resolves stored AgentConfig,
	 * runs against a persisted chat session with DAG message tracking.
	 */
	public async runAgentChat(
		opts: AgentChatOptions,
		emit?: StreamEmitter,
		context?: HandlerContext,
	): Promise<any> {
		const agentConfig = this.repos.agent.get(opts.agentId);
		if (!agentConfig)
			throw new Error(`Agent config not found: ${opts.agentId}`);

		const resolved = await this.providerManager.resolve(
			agentConfig.modelId,
			agentConfig.params,
		);

		// Create execution record
		const execution = this.repos.execution.create({
			type: "chat",
			sessionId: opts.sessionId,
			agentId: opts.agentId,
			input: opts.prompt,
		});

		const stateAdapter = new StateAdapter({
			executionId: execution.id,
			sessionId: opts.sessionId,
			stateNodeRepo: this.repos.stateNode,
			messageRepo: this.repos.message,
			sessionRepo: this.repos.session,
			executionRepo: this.repos.execution,
		});

		this.repos.auditEvent.create({
			executionId: execution.id,
			kind: "execution.start",
		});
		stateAdapter.recordStep("agent_start", { agentId: opts.agentId });

		// Persist user message in DAG
		const session = this.repos.session.get(opts.sessionId);
		if (opts.persistUserMessage !== false) {
			const userMsgInput: CreateMessageInput = {
				sessionId: opts.sessionId,
				parentId: session?.headMessageId ?? null,
				role: "user",
				content: opts.prompt,
				providerType: resolved.provider.type,
				modelId: resolved.model.modelId,
			};
			stateAdapter.persistMessage(userMsgInput);
		}

		// Resolve tools
		const sessionTools = this.repos.session.getTools(opts.sessionId);
		const effectiveToolIds =
			opts.toolIds ?? sessionTools.map((t) => t.id as unknown as string);
		const sessionMcpServers = this.repos.session.getMcpServers(opts.sessionId);
		const mcpServerIds = sessionMcpServers.map((s) => s.id);

		const functionTools = await this.buildFunctionTools(
			effectiveToolIds,
			mcpServerIds,
			context,
		);

		// Build history for prompt
		const historyMessages =
			opts.historyMessages ??
			this.getSessionHistory(opts.sessionId, opts.prompt);
		const enrichedPrompt = this.composePromptWithHistory(
			opts.prompt,
			historyMessages,
		);

		// Build ADK agent
		const agent = new LlmAgent({
			name: sanitizeName(agentConfig.name),
			model:
				resolved.modelString ??
				`vloop://${resolved.provider.type}/${resolved.model.id}`,
			instruction: agentConfig.systemPrompt || "You are a helpful assistant.",
			tools: functionTools,
		});

		const appName = sanitizeName(`chat_${opts.agentId}`);
		const runner = new InMemoryRunner({ agent, appName });
		const adkSession = await runner.sessionService.createSession({
			appName,
			userId: "chat_user",
		});

		const startedAt = Date.now();
		let seq = 0;
		let fullText = "";
		const toolCalls: any[] = [];
		const toolResults: any[] = [];

		const events = runner.runAsync({
			userId: "chat_user",
			sessionId: adkSession.id,
			newMessage: { role: "user", parts: [{ text: enrichedPrompt }] },
		});

		try {
			for await (const rawEvent of events) {
				const event = this.normalizeEventToolCalls(
					rawEvent,
					resolved.provider.type,
				);
				const modelError = (event as any)?.errorMessage as string | undefined;
				const modelCode = (event as any)?.errorCode as string | undefined;
				if (modelError || modelCode) {
					stateAdapter.failStep(stateAdapter.getLastNodeId()!);
					this.repos.execution.updateStatus(execution.id, "failed");
					this.repos.auditEvent.create({
						executionId: execution.id,
						kind: "execution.fail",
						payload: { error: modelError },
					});
					throw new Error(
						modelError ||
							`Model execution failed${modelCode ? ` (${modelCode})` : ""}`,
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

				// Record as state node
				const nodeId = stateAdapter.recordStep("llm_call", {
					author: event.author,
					hasText: Boolean(chunkText),
				});
				stateAdapter.completeStep(nodeId, { seq });

				if (emit) {
					const mappedEvent: any = { ...event };
					if (chunkText) mappedEvent.text = chunkText;
					if (chunkToolCalls.length > 0) mappedEvent.toolCalls = chunkToolCalls;
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
		} catch (err: any) {
			if (this.isMissingThoughtSignatureError(err)) {
				this.logger.warn(
					{ err: err?.message },
					"Recovered from missing thought_signature tool-call runtime error",
				);
			} else {
				throw err;
			}
		}

		// Persist assistant message in DAG
		const session2 = this.repos.session.get(opts.sessionId);
		const assistantMsgInput: CreateMessageInput = {
			sessionId: opts.sessionId,
			parentId: session2?.headMessageId ?? null,
			role: "assistant",
			content: fullText,
			toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
			toolResults: toolResults.length > 0 ? toolResults : undefined,
			providerType: resolved.provider.type,
			modelId: resolved.model.modelId,
			latencyMs: Date.now() - startedAt,
			metadata: { adapter: resolved.adapter },
		};
		stateAdapter.persistMessage(assistantMsgInput);

		// Complete execution
		const endNodeId = stateAdapter.recordStep("agent_end", {
			output: fullText.substring(0, 500),
		});
		stateAdapter.completeStep(endNodeId);
		this.repos.execution.updateStatus(execution.id, "completed", fullText);
		this.repos.auditEvent.create({
			executionId: execution.id,
			kind: "execution.complete",
		});

		return {
			status: "completed",
			model: resolved.modelString,
			result: fullText,
			toolCalls,
		};
	}

	/**
	 * Simple chat completion — direct model call without agent config.
	 */
	public async runChatCompletion(
		opts: {
			model?: string;
			modelId?: ModelId | string;
			prompt: string;
			systemPrompt?: string;
			sessionId?: SessionId;
			toolIds?: string[];
			persistUserMessage?: boolean;
			historyMessages?: Message[];
		},
		emit?: StreamEmitter,
	): Promise<any> {
		const resolved = await this.resolveRuntimeForCompletion(opts);

		// Create execution
		const execution = this.repos.execution.create({
			type: "chat",
			sessionId: opts.sessionId,
			input: opts.prompt,
		});

		// Persist user message
		if (opts.sessionId && opts.persistUserMessage !== false) {
			const session = this.repos.session.get(opts.sessionId);
			const userMsg: CreateMessageInput = {
				sessionId: opts.sessionId,
				parentId: session?.headMessageId ?? null,
				role: "user",
				content: opts.prompt,
				providerType: resolved.provider.type,
				modelId: resolved.model.modelId,
			};
			this.repos.message.create(userMsg);
			const created = this.repos.message.listBySession(opts.sessionId);
			const last = created[created.length - 1];
			if (last) this.repos.session.setHeadMessage(opts.sessionId, last.id);
		}

		const sessionToolIds = opts.sessionId
			? this.repos.session
					.getTools(opts.sessionId)
					.map((t) => t.id as string)
			: [];
		const sessionMcpServerIds = opts.sessionId
			? this.repos.session.getMcpServers(opts.sessionId).map((s) => s.id)
			: [];
		const effectiveToolIds = opts.toolIds ?? sessionToolIds;
		const functionTools = await this.buildFunctionTools(
			effectiveToolIds,
			sessionMcpServerIds,
		);

		const historyMessages =
			opts.historyMessages ??
			this.getSessionHistory(opts.sessionId, opts.prompt);

		const agent = new LlmAgent({
			name: "chat_completion",
			model: resolved.modelString!,
			description: "Simple chat assistant.",
			instruction:
				opts.systemPrompt ||
				"You are a helpful AI assistant. Respond clearly and concisely.",
			tools: functionTools,
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
		const adkSession = await runner.sessionService.createSession({
			appName: "chat_completion",
			userId: "chat_user",
		});

		const startedAt = Date.now();
		let seq = 0;
		let fullText = "";
		const toolCalls: any[] = [];
		const toolResults: any[] = [];

		const events = runner.runAsync({
			userId: "chat_user",
			sessionId: adkSession.id,
			newMessage: {
				role: "user",
				parts: [
					{ text: this.composePromptWithHistory(opts.prompt, historyMessages) },
				],
			},
		});

		try {
			for await (const rawEvent of events) {
				const event = this.normalizeEventToolCalls(
					rawEvent,
					resolved.provider.type,
				);
				const modelError = (event as any)?.errorMessage as string | undefined;
				const modelCode = (event as any)?.errorCode as string | undefined;
				if (modelError || modelCode) {
					throw new Error(
						modelError ||
							`Model execution failed${modelCode ? ` (${modelCode})` : ""}`,
					);
				}

				let chunkText = "";
				if (event.content?.parts) {
					for (const part of event.content.parts) {
						if ("text" in part && part.text) {
							chunkText += part.text;
							fullText += part.text;
						}
						if ("functionCall" in part) toolCalls.push(part.functionCall);
						if ("functionResponse" in part)
							toolResults.push(part.functionResponse);
					}
				}
				if (emit) {
					const mappedEvent: any = { ...event };
					if (chunkText) mappedEvent.text = chunkText;
					emit("stream", mappedEvent, seq++);
				}
			}
		} catch (err: any) {
			if (this.isMissingThoughtSignatureError(err)) {
				this.logger.warn(
					{ err: err?.message },
					"Recovered from missing thought_signature tool-call runtime error",
				);
			} else {
				throw err;
			}
		}

		// Persist assistant message
		if (opts.sessionId) {
			const session2 = this.repos.session.get(opts.sessionId);
			const assistantMsg: CreateMessageInput = {
				sessionId: opts.sessionId,
				parentId: session2?.headMessageId ?? null,
				role: "assistant",
				content: fullText,
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
				toolResults: toolResults.length > 0 ? toolResults : undefined,
				providerType: resolved.provider.type,
				modelId: resolved.model.modelId,
				latencyMs: Date.now() - startedAt,
				metadata: { adapter: resolved.adapter },
			};
			const msg = this.repos.message.create(assistantMsg);
			this.repos.session.setHeadMessage(opts.sessionId, msg.id);
		}

		this.repos.execution.updateStatus(execution.id, "completed", fullText);

		return {
			status: "completed",
			model: resolved.model.modelId,
			result: fullText,
			toolCalls,
		};
	}

	/**
	 * DAG-native rerun — creates a NEW branch from the parent of the target message.
	 * Does NOT delete history. The original branch remains intact.
	 */
	public async rerunChatFromMessage(
		opts: { sessionId: SessionId; messageId: string; toolIds?: string[] },
		emit?: StreamEmitter,
		context?: HandlerContext,
	): Promise<any> {
		const session = this.repos.session.get(opts.sessionId);
		if (!session) throw new Error(`Chat session not found: ${opts.sessionId}`);

		const allMessages = this.repos.message.listBySession(opts.sessionId);
		const anchor = allMessages.find((m) => m.id === opts.messageId);
		if (!anchor) throw new Error(`Chat message not found: ${opts.messageId}`);

		// Find the user message to rerun
		let rerunUserMsg: Message | undefined;
		if (anchor.role === "user") {
			rerunUserMsg = anchor;
		} else {
			// Walk ancestry to find nearest user message
			const ancestry = this.repos.message.getAncestry(anchor.id);
			rerunUserMsg = [...ancestry].reverse().find((m) => m.role === "user");
		}
		if (!rerunUserMsg)
			throw new Error("No user prompt found before selected message");

		// DAG branch: the new response attaches as a child of the rerun user message's parent
		const historyChain = rerunUserMsg.parentId
			? this.repos.message.getAncestry(rerunUserMsg.parentId)
			: [];

		if (session.agentId) {
			return this.runAgentChat(
				{
					agentId: session.agentId,
					sessionId: opts.sessionId,
					prompt: rerunUserMsg.content,
					toolIds: opts.toolIds,
					persistUserMessage: false,
					historyMessages: historyChain,
				},
				emit,
				context,
			);
		}

		const modelRef = session.modelId ?? rerunUserMsg.modelId;
		return this.runChatCompletion(
			{
				modelId: modelRef,
				prompt: rerunUserMsg.content,
				sessionId: opts.sessionId,
				toolIds: opts.toolIds,
				persistUserMessage: false,
				historyMessages: historyChain,
			},
			emit,
		);
	}

	/**
	 * DAG-native fork — creates a new session with the DAG ancestry up to the target message.
	 */
	public forkChatFromMessage(opts: {
		sessionId: SessionId;
		messageId: string;
		title?: string;
	}): { session: any } {
		const srcSession = this.repos.session.get(opts.sessionId);
		if (!srcSession) throw new Error(`Session not found: ${opts.sessionId}`);

		// Create new session
		const newSession = this.repos.session.create({
			agentId: srcSession.agentId,
			workflowId: srcSession.workflowId,
			modelId: srcSession.modelId,
			providerId: srcSession.providerId,
			mode: srcSession.mode,
			title: opts.title ?? `Fork of ${srcSession.title}`,
			toolIds: srcSession.toolIds,
			mcpServerIds: srcSession.mcpServerIds,
		});

		// Copy message ancestry into new session
		const ancestry = this.repos.message.getAncestry(
			opts.messageId as MessageId,
		);
		let lastNewId: MessageId | null = null;
		for (const msg of ancestry) {
			const newMsg = this.repos.message.create({
				sessionId: newSession.id,
				parentId: lastNewId,
				branch: "main",
				role: msg.role,
				content: msg.content,
				toolCalls: msg.toolCalls,
				toolResults: msg.toolResults,
				providerType: msg.providerType,
				modelId: msg.modelId,
				metadata: msg.metadata,
			});
			lastNewId = newMsg.id;
		}
		if (lastNewId) {
			this.repos.session.setHeadMessage(newSession.id, lastNewId);
		}

		return { session: this.repos.session.get(newSession.id) };
	}

	/**
	 * Config-based workflow execution via worker thread.
	 */
	public async runWorkflow(
		workflowId: WorkflowId,
		input: string,
		emit?: StreamEmitter,
		_context?: HandlerContext,
	): Promise<any> {
		const workflow = this.repos.workflow.get(workflowId);
		if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

		const execution = this.repos.execution.create({
			type: "workflow",
			workflowId,
			input,
		});

		return this.workerDispatcher.runExecution(
			{
				type: "start",
				executionId: execution.id,
				sessionId: "" as SessionId,
				workflowId,
				prompt: input,
				dbPath: "",
				dbPassphrase: "",
			},
			emit,
		);
	}

	/**
	 * Context compaction — summarize older messages while keeping recent ones.
	 */
	public compactChatContext(opts: {
		sessionId: SessionId;
		maxChars?: number;
		keepLastMessages?: number;
	}): {
		compacted: boolean;
		deletedMessages: number;
		summary?: string;
		totalMessages: number;
		remainingMessages: number;
	} {
		const session = this.repos.session.get(opts.sessionId);
		if (!session) throw new Error(`Chat session not found: ${opts.sessionId}`);

		const allMessages = this.repos.message.listBySession(opts.sessionId);
		const compacted = this.compactHistoryMessages(allMessages, {
			maxChars: opts.maxChars,
			keepLastMessages: opts.keepLastMessages,
		});

		if (!compacted.didCompact) {
			return {
				compacted: false,
				deletedMessages: 0,
				totalMessages: allMessages.length,
				remainingMessages: allMessages.length,
			};
		}

		// Insert a summary system message before the recent messages
		const firstRecent = compacted.recentMessages[0];
		this.repos.message.create({
			sessionId: opts.sessionId,
			parentId: firstRecent?.parentId ?? null,
			role: "system",
			content: `Context was compacted.\n\n${compacted.summary}`,
			metadata: {
				contextCompaction: true,
				compactedAt: new Date().toISOString(),
			},
		});

		return {
			compacted: true,
			deletedMessages: compacted.deletedCount,
			summary: compacted.summary,
			totalMessages: allMessages.length,
			remainingMessages: compacted.recentMessages.length + 1,
		};
	}

	// ── Private helpers ──────────────────────────────────────────────────

	private async buildFunctionTools(
		toolIds: string[],
		mcpServerIds: string[],
		context?: HandlerContext,
	): Promise<FunctionTool[]> {
		const result: FunctionTool[] = [];

		for (const toolId of toolIds) {
			// Check builtin tools
			const builtin = this.tools.get(toolId);
			if (builtin) {
				result.push(
					new FunctionTool({
						name: builtin.name,
						description: builtin.description,
						parameters: builtin.parameters,
						execute: async (args: any) => await builtin.execute!(args, context),
					}),
				);
				continue;
			}

			// Check stored tool configs
			const toolConfig = this.repos.tool.get(toolId as any);
			if (toolConfig) {
				result.push(
					new FunctionTool({
						name: toolConfig.name,
						description: toolConfig.description,
						parameters: toolConfig.parametersSchema as any,
						execute: async (args: any) => {
							switch (toolConfig.handlerType) {
								case "builtin": {
									const builtinName = (toolConfig.handlerConfig as any).name;
									const b = this.tools.get(builtinName);
									if (!b?.execute)
										throw new Error(`Builtin tool not found: ${builtinName}`);
									return await b.execute(args, context);
								}
								case "api": {
									const url = (toolConfig.handlerConfig as any).url;
									const method =
										(toolConfig.handlerConfig as any).method || "POST";
									const response = await fetch(url, {
										method,
										headers: { "Content-Type": "application/json" },
										body: JSON.stringify(args),
									});
									return await response.json();
								}
								default:
									throw new Error(
										`Unknown tool handler type: ${toolConfig.handlerType}`,
									);
							}
						},
					}),
				);
				continue;
			}

			this.logger.warn({ toolId }, "Tool not found, skipping");
		}

		// MCP tools
		if (mcpServerIds.length > 0) {
			const mcpTools = await this.mcpManager.resolveFunctionTools(
				mcpServerIds as any,
			);
			result.push(...mcpTools);
		}

		return result;
	}

	private getSessionHistory(
		sessionId?: SessionId,
		latestPrompt?: string,
	): Message[] {
		if (!sessionId) return [];
		const all = this.repos.message.listBySession(sessionId);
		if (all.length === 0) return [];
		const last = all[all.length - 1];
		if (
			last?.role === "user" &&
			latestPrompt &&
			last.content === latestPrompt
		) {
			return all.slice(0, -1);
		}
		return all;
	}

	private composePromptWithHistory(
		latestPrompt: string,
		historyMessages?: Message[],
	): string {
		if (!historyMessages || historyMessages.length === 0) return latestPrompt;

		const compacted = this.compactHistoryMessages(historyMessages);
		const promptHistory = compacted.promptHistory;
		if (promptHistory.length === 0) return latestPrompt;

		const formattedHistory = promptHistory
			.filter((m) => ["system", "user", "assistant", "tool"].includes(m.role))
			.map((m) => {
				const label =
					m.role === "assistant"
						? "Assistant"
						: m.role === "user"
							? "User"
							: m.role === "system"
								? "System"
								: "Tool";
				return `${label}:\n${m.content}`;
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
		]
			.filter(Boolean)
			.join("\n");
	}

	private compactHistoryMessages(
		msgs: Message[],
		opts?: { maxChars?: number; keepLastMessages?: number },
	): {
		didCompact: boolean;
		summary: string;
		promptHistory: Message[];
		recentMessages: Message[];
		deletedCount: number;
	} {
		const maxChars = opts?.maxChars ?? 24_000;
		const keepLast = opts?.keepLastMessages ?? 12;
		const totalChars = msgs.reduce(
			(acc, m) => acc + (m.content?.length ?? 0),
			0,
		);

		if (totalChars <= maxChars || msgs.length <= keepLast) {
			return {
				didCompact: false,
				summary: "",
				promptHistory: msgs,
				recentMessages: msgs,
				deletedCount: 0,
			};
		}

		const splitIndex = Math.max(1, msgs.length - keepLast);
		const older = msgs.slice(0, splitIndex);
		const recent = msgs.slice(splitIndex);
		const summary = this.summarizeMessages(older);

		const summaryMsg: Message = {
			id: "context-summary" as MessageId,
			sessionId: recent[0]?.sessionId ?? ("" as SessionId),
			parentId: null,
			branch: "main",
			role: "system",
			content: `Summary of earlier conversation:\n${summary}`,
			createdAt: new Date().toISOString(),
		};

		return {
			didCompact: true,
			summary,
			promptHistory: [summaryMsg, ...recent],
			recentMessages: recent,
			deletedCount: older.length,
		};
	}

	private summarizeMessages(messages: Message[]): string {
		const lines: string[] = [];
		for (const m of messages) {
			const role =
				m.role === "assistant"
					? "Assistant"
					: m.role === "user"
						? "User"
						: "System";
			const content = (m.content || "").replace(/\s+/g, " ").trim();
			if (!content) continue;
			const clipped =
				content.length > 280 ? `${content.slice(0, 277)}...` : content;
			lines.push(`- ${role}: ${clipped}`);
			if (lines.length >= 60) break;
		}
		if (lines.length === 0)
			return "No significant earlier conversation content.";
		const joined = lines.join("\n");
		return joined.length > 4_000 ? `${joined.slice(0, 3_997)}...` : joined;
	}

	private async resolveRuntimeForCompletion(opts: {
		model?: string;
		modelId?: ModelId | string;
	}): Promise<ResolvedModel> {
		const ref = opts.modelId || opts.model;
		if (ref) {
			const byId = this.repos.model.get(ref as ModelId);
			if (byId) return this.providerManager.resolve(byId.id);

			const allModels = this.repos.model.list();
			const byString = allModels.find((m) => m.modelId === ref);
			if (byString) return this.providerManager.resolve(byString.id);
		}

		// Fallback for ad-hoc model strings
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

	private normalizeEventToolCalls(event: any, providerType: string): any {
		if (!event?.content?.parts || !Array.isArray(event.content.parts))
			return event;

		const normalizedParts = event.content.parts.map((part: any) => {
			if (
				!part ||
				typeof part !== "object" ||
				!("functionCall" in part) ||
				!part.functionCall
			) {
				return part;
			}

			const fc = this.normalizeFunctionCall(part.functionCall, providerType);
			return {
				...part,
				functionCall: fc,
				thoughtSignature: fc.thoughtSignature,
				thought_signature: fc.thought_signature,
			};
		});

		return {
			...event,
			content: {
				...event.content,
				parts: normalizedParts,
			},
		};
	}

	private normalizeFunctionCall(functionCall: any, providerType: string): any {
		if (!functionCall || typeof functionCall !== "object") return functionCall;

		const rawSnake = functionCall.thought_signature;
		const rawCamel = functionCall.thoughtSignature;
		const sig =
			typeof rawSnake === "string" && rawSnake.trim().length > 0
				? rawSnake
				: typeof rawCamel === "string" && rawCamel.trim().length > 0
					? rawCamel
					: providerType;

		return {
			...functionCall,
			thoughtSignature: sig,
			thought_signature: sig,
		};
	}

	private isMissingThoughtSignatureError(err: unknown): boolean {
		const msg = (err as any)?.message;
		return (
			typeof msg === "string" && msg.includes("missing a thought_signature")
		);
	}
}
