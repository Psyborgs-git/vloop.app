/**
 * Orchestrator tests — exercises AgentOrchestratorV2 with real DB repos.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import type { AiAgentOrm } from '../orm-type.js';
import { createTestDb } from './test-db.js';

import { ProviderRepo } from '../repos/provider-repo.js';
import { ModelRepo } from '../repos/model-repo.js';
import { ToolRepo } from '../repos/tool-repo.js';
import { McpServerRepo } from '../repos/mcp-server-repo.js';
import { AgentRepo } from '../repos/agent-repo.js';
import { WorkflowRepo } from '../repos/workflow-repo.js';
import { SessionRepo } from '../repos/session-repo.js';
import { MessageRepo } from '../repos/message-repo.js';
import { StateNodeRepo } from '../repos/state-node-repo.js';
import { ExecutionRepo } from '../repos/execution-repo.js';
import { WorkerRunRepo } from '../repos/worker-run-repo.js';
import { HitlWaitRepo } from '../repos/hitl-wait-repo.js';
import { AuditEventRepo } from '../repos/audit-event-repo.js';
import { MemoryRepo } from '../repos/memory-repo.js';
import { CanvasRepo } from '../repos/canvas-repo.js';
import type { OrchestratorRepos } from '../orchestrator.js';

let db: InstanceType<typeof Database>;
let orm: AiAgentOrm;
let repos: OrchestratorRepos;

beforeEach(() => {
	const ctx = createTestDb();
	db = ctx.db;
	orm = ctx.orm;
	repos = {
		provider: new ProviderRepo(orm),
		model: new ModelRepo(orm),
		tool: new ToolRepo(orm),
		mcpServer: new McpServerRepo(orm),
		agent: new AgentRepo(orm),
		workflow: new WorkflowRepo(orm),
		session: new SessionRepo(orm),
		message: new MessageRepo(orm),
		stateNode: new StateNodeRepo(orm),
		execution: new ExecutionRepo(orm),
		workerRun: new WorkerRunRepo(orm),
		hitlWait: new HitlWaitRepo(orm),
		auditEvent: new AuditEventRepo(orm),
		memory: new MemoryRepo(orm),
		canvas: new CanvasRepo(orm),
	};
});
afterEach(() => db.close());

// Mock @jaex/dstsx to avoid real LLM calls
vi.mock('@jaex/dstsx', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@jaex/dstsx')>();
	return {
		...actual,
		Predict: vi.fn().mockImplementation(function () {
			return {
				instructions: undefined,
				forward: vi.fn().mockResolvedValue({
					get: (key: string) => key === 'answer' ? 'Mock response' : undefined,
				}),
				stream: vi.fn().mockReturnValue((async function* () {
					yield { delta: 'Mock response', done: true, raw: null };
				})()),
			};
		}),
		ReAct: vi.fn().mockImplementation(function () {
			return {
				forward: vi.fn().mockResolvedValue({
					get: (key: string) => key === 'answer' ? 'Mock response' : undefined,
				}),
			};
		}),
		settings: {
			configure: vi.fn(),
			context: vi.fn().mockImplementation(async (_opts: any, fn: () => Promise<any>) => fn()),
		},
	};
});

// Mock the LM factory
vi.mock('../../config/lm-factory.js', () => ({
	createLM: vi.fn().mockReturnValue({
		model: 'mock-model',
		call: vi.fn(),
		stream: vi.fn(),
	}),
}));

// Import after mocks are established
const { AgentOrchestratorV2 } = await import('../orchestrator.js');
const { ToolRegistry } = await import('../../tools.js');

describe('AgentOrchestratorV2', () => {
	function createOrchestrator() {
		const mockLogger = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() } as any;
		return new AgentOrchestratorV2(
			new ToolRegistry(mockLogger), { run: vi.fn() } as any, mockLogger, repos,
		);
	}

	it('can be constructed with repos', () => {
		const orchestrator = createOrchestrator();
		expect(orchestrator.repos).toBe(repos);
		expect(orchestrator.providerManager).toBeDefined();
		expect(orchestrator.mcpManager).toBeDefined();
	});

	it('forkChatFromMessage creates a new session with ancestry', () => {
		const orchestrator = createOrchestrator();

		const session = repos.session.create({ title: 'Original', mode: 'chat' });
		const m1 = repos.message.create({ sessionId: session.id, parentId: null, role: 'user', content: 'Hello' });
		const m2 = repos.message.create({ sessionId: session.id, parentId: m1.id, role: 'assistant', content: 'Hi' });
		const m3 = repos.message.create({ sessionId: session.id, parentId: m2.id, role: 'user', content: 'How?' });

		const result = orchestrator.forkChatFromMessage({
			sessionId: session.id,
			messageId: m3.id,
			title: 'Forked',
		});

		expect(result.session).toBeDefined();
		expect(result.session.title).toBe('Forked');

		const forkedMessages = repos.message.listBySession(result.session.id);
		expect(forkedMessages).toHaveLength(3);
		expect(forkedMessages[0].role).toBe('user');
		expect(forkedMessages[0].content).toBe('Hello');
	});

	it('compactChatContext returns not-compacted for short history', () => {
		const orchestrator = createOrchestrator();

		const session = repos.session.create({ title: 'Test', mode: 'chat' });
		repos.message.create({ sessionId: session.id, parentId: null, role: 'user', content: 'Short message' });

		const result = orchestrator.compactChatContext({ sessionId: session.id });
		expect(result.compacted).toBe(false);
		expect(result.totalMessages).toBe(1);
	});

	it('runChatCompletion uses dstsx Predict and returns result', async () => {
		const provider = repos.provider.create({
			name: 'Local Ollama',
			type: 'ollama',
			baseUrl: 'http://localhost:11434',
		});
		const model = repos.model.create({
			name: 'Ollama Model',
			providerId: provider.id,
			modelId: 'llama3.2:latest',
			supportsTools: true,
			supportsStreaming: true,
		});

		const orchestrator = createOrchestrator();
		const result = await orchestrator.runChatCompletion({
			modelId: model.id,
			prompt: 'Hello world',
		});

		expect(result.status).toBe('completed');
		expect(result.result).toBe('Mock response');
	});
});
