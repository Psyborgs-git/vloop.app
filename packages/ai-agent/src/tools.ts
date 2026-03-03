import type { DependencyContainer } from "tsyringe";
import { TOKENS, OrchestratorError, ErrorCode } from "@orch/shared";
import type { Logger, HandlerContext, Request as RouterRequest } from "@orch/daemon";
import type { AppRouterContract, AppToolRegistryContract } from "@orch/shared";
import { BrowserTool } from "./tools/browser.js";
import { createAgentSearchTool } from "./tools/agent-search.js";
import { createDelegateTaskTool } from './tools/delegate-task.js';
import { createTriggerWorkflowTool } from './tools/trigger-workflow.js';
import { createWorkflowSearchTool } from './tools/workflow-search.js';
import { createCanvasTools } from './tools/canvas-tools.js';
import { AgentOrchestratorV2 } from "./v2/orchestrator.js";

export interface ToolDefinition<Params = unknown, Result = unknown> {
	name: string;
	description: string;
	parameters: Record<string, unknown>; // JSON Schema Object
	execute?: {
		bivarianceHack: (params: Params, context?: HandlerContext) => Promise<Result> | Result;
	}["bivarianceHack"];
}

export class ToolRegistry {
	private readonly tools = new Map<string, ToolDefinition>();

	constructor(private readonly logger: Logger) {}

	public register(tool: ToolDefinition) {
		if (this.tools.has(tool.name)) {
			throw new OrchestratorError(
				ErrorCode.ALREADY_EXISTS,
				`Tool already exists: ${tool.name}`,
			);
		}
		this.tools.set(tool.name, tool);
		this.logger.debug({ tool: tool.name }, "Registered new AI tool");
	}

	public get(name: string): ToolDefinition | undefined {
		return this.tools.get(name);
	}

	public list(): ToolDefinition[] {
		return Array.from(this.tools.values());
	}
}

export function registerTools(
	container: DependencyContainer,
	toolRegistry: AppToolRegistryContract,
	router: AppRouterContract,
): void {
	const logger = container.resolve<Logger>(TOKENS.Logger);
	const dispatch = router.dispatch?.bind(router);
	if (!dispatch) {
		throw new Error("Router dispatch is required for ai-agent tool registration");
	}
	const getTool = toolRegistry.get?.bind(toolRegistry);

	const registerIfMissing = <Params = unknown, Result = unknown>(tool: ToolDefinition<Params, Result>) => {
		if (getTool?.(tool.name)) {
			logger.debug({ tool: tool.name }, "Skipping duplicate AI tool registration");
			return;
		}
		toolRegistry.register(tool);
	};

	const browserTool = new BrowserTool(logger);
	registerIfMissing({
		...browserTool.definition,
		execute: async (args: unknown) => browserTool.execute(args),
	});

	try {
		const orchestrator = container.resolve(AgentOrchestratorV2);
		const searchAgents = createAgentSearchTool(orchestrator.repos.agent);
		registerIfMissing({ ...searchAgents, name: 'search_agents' });
		registerIfMissing(searchAgents);
		registerIfMissing(createWorkflowSearchTool(orchestrator.repos.workflow));
		registerIfMissing(createDelegateTaskTool(orchestrator));
		registerIfMissing(createTriggerWorkflowTool(orchestrator));

		const dispatchToolAction = async (
			topic: string,
			action: string,
			payload: unknown,
			context: HandlerContext,
		) => {
			const request: RouterRequest = {
				id: `tool-${Date.now()}`,
				topic,
				action,
				payload,
				meta: {
					session_id: context.request?.meta?.session_id ?? context.sessionId,
					trace_id: context.request?.meta?.trace_id,
					timestamp: new Date().toISOString(),
				},
			};

			const response = await dispatch(request, context.logger);

			if (response.type === 'error') {
				throw new Error(typeof response.payload === 'string' ? response.payload : JSON.stringify(response.payload));
			}

			return response.payload;
		};

		for (const tool of createCanvasTools(dispatchToolAction)) {
			registerIfMissing(tool);
		}
	} catch (e) {
		logger.debug(
			{ error: (e as Error).message },
			"AgentOrchestratorV2 not available while registering ai-agent tools",
		);
	}
}
