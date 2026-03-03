/**
 * Handler routing tests — verifies action dispatch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAgentHandlerV2 } from '../handler.js';
import type { AgentOrchestratorV2, OrchestratorRepos } from '../orchestrator.js';
import type { CanvasRepo } from '../repos/canvas-repo.js';

function makeMockRepos(): OrchestratorRepos {
	const stubRepo = () => ({
		create: vi.fn().mockReturnValue({ id: 'test-id' }),
		get: vi.fn().mockReturnValue(null),
		list: vi.fn().mockReturnValue([]),
		update: vi.fn().mockReturnValue({}),
		delete: vi.fn(),
		listBySession: vi.fn().mockReturnValue([]),
		getAncestry: vi.fn().mockReturnValue([]),
		setHeadMessage: vi.fn(),
		setTools: vi.fn(),
		getTools: vi.fn().mockReturnValue([]),
		setMcpServers: vi.fn(),
		getMcpServers: vi.fn().mockReturnValue([]),
		updateStatus: vi.fn(),
		complete: vi.fn(),
		resolve: vi.fn(),
		search: vi.fn().mockReturnValue([]),
	});
	return {
		provider: stubRepo(),
		model: stubRepo(),
		tool: stubRepo(),
		mcpServer: stubRepo(),
		agent: stubRepo(),
		workflow: stubRepo(),
		session: stubRepo(),
		message: stubRepo(),
		stateNode: stubRepo(),
		execution: stubRepo(),
		workerRun: stubRepo(),
		hitlWait: stubRepo(),
		auditEvent: stubRepo(),
		memory: stubRepo(),
		canvas: stubRepo(),
	} as any;
}

function makeMockOrchestrator(repos: OrchestratorRepos): AgentOrchestratorV2 {
	return {
		repos,
		tools: {
			get: vi.fn().mockReturnValue(null),
			list: vi.fn().mockReturnValue([]),
		},
		providerManager: { resolve: vi.fn() },
		mcpManager: {},
		workerDispatcher: {},
		runAgentChat: vi.fn().mockResolvedValue({ status: 'completed', result: 'ok' }),
		runChatCompletion: vi.fn().mockResolvedValue({ status: 'completed', result: 'ok' }),
		rerunChatFromMessage: vi.fn().mockResolvedValue({ status: 'completed' }),
		forkChatFromMessage: vi.fn().mockReturnValue({ session: {} }),
		runWorkflow: vi.fn().mockResolvedValue({ status: 'completed' }),
		compactChatContext: vi.fn().mockReturnValue({ compacted: false, deletedMessages: 0, totalMessages: 0, remainingMessages: 0 }),
	} as any;
}

function makeMockCanvasRepo(): CanvasRepo {
	return {
		create: vi.fn().mockReturnValue({ id: 'canvas-1', name: 'Test' }),
		get: vi.fn().mockReturnValue({ id: 'canvas-1', name: 'Test' }),
		listCanvases: vi.fn().mockReturnValue([]),
		update: vi.fn().mockReturnValue({}),
		delete: vi.fn(),
		listCanvasCommits: vi.fn().mockReturnValue([]),
		rollbackCanvas: vi.fn().mockReturnValue({}),
	} as any;
}

describe('createAgentHandlerV2', () => {
	let repos: OrchestratorRepos;
	let orchestrator: AgentOrchestratorV2;
	let canvasRepo: CanvasRepo;
	let handler: (action: string, payload: unknown, ctx: any) => Promise<any>;
	const ctx = {} as any;

	beforeEach(() => {
		repos = makeMockRepos();
		orchestrator = makeMockOrchestrator(repos);
		canvasRepo = makeMockCanvasRepo();
		handler = createAgentHandlerV2(orchestrator, canvasRepo);
	});

	it('routes provider.list action', async () => {
		await handler('agent.provider.list', {}, ctx);
		expect(repos.provider.list).toHaveBeenCalled();
	});

	it('routes provider.create action', async () => {
		await handler('agent.provider.create', { name: 'test', type: 'openai' }, ctx);
		expect(repos.provider.create).toHaveBeenCalled();
	});

	it('routes model.list action', async () => {
		await handler('agent.model.list', {}, ctx);
		expect(repos.model.list).toHaveBeenCalled();
	});

	it('routes tool.list action', async () => {
		await handler('agent.tool.list', {}, ctx);
		expect(repos.tool.list).toHaveBeenCalled();
	});

	it('routes config.list (agent list) action', async () => {
		await handler('agent.config.list', {}, ctx);
		expect(repos.agent.list).toHaveBeenCalled();
	});

	it('routes chat.list (session list) action', async () => {
		await handler('agent.chat.list', {}, ctx);
		expect(repos.session.list).toHaveBeenCalled();
	});

	it('routes memory.list action', async () => {
		await handler('agent.memory.list', {}, ctx);
		expect(repos.memory.list).toHaveBeenCalled();
	});

	it('routes canvas.list action', async () => {
		await handler('agent.canvas.list', {}, ctx);
		expect(canvasRepo.listCanvases).toHaveBeenCalled();
	});

	it('routes canvas.get action', async () => {
		await handler('agent.canvas.get', { id: 'canvas-1' }, ctx);
		expect(canvasRepo.get).toHaveBeenCalledWith('canvas-1');
	});

	it('routes canvas.create action', async () => {
		await handler('agent.canvas.create', { name: 'New', owner: 'user' }, ctx);
		expect(canvasRepo.create).toHaveBeenCalled();
	});

	it('throws on unknown action', async () => {
		await expect(handler('agent.nonexistent.action', {}, ctx)).rejects.toThrow('Unknown agent action');
	});

	it('strips agent. prefix from action', async () => {
		await handler('agent.provider.list', {}, ctx);
		expect(repos.provider.list).toHaveBeenCalled();
	});

	it('works without agent. prefix', async () => {
		await handler('provider.list', {}, ctx);
		expect(repos.provider.list).toHaveBeenCalled();
	});
});
