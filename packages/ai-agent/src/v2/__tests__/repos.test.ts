/**
 * Repository CRUD tests — exercises all 15 repos against an in-memory SQLite database.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

let db: InstanceType<typeof Database>;
let orm: AiAgentOrm;

beforeEach(() => {
	const ctx = createTestDb();
	db = ctx.db;
	orm = ctx.orm;
});
afterEach(() => db.close());

// ── Provider ─────────────────────────────────────────────────────────────────

describe('ProviderRepo', () => {
	it('creates and lists providers', () => {
		const repo = new ProviderRepo(orm);
		const p = repo.create({ name: 'openai', type: 'openai', adapter: 'adk-native' });
		expect(p.id).toBeDefined();
		expect(p.name).toBe('openai');
		expect(p.type).toBe('openai');

		const all = repo.list();
		expect(all).toHaveLength(1);
		expect(all[0].id).toBe(p.id);
	});

	it('gets, updates, deletes', () => {
		const repo = new ProviderRepo(orm);
		const p = repo.create({ name: 'anthropic', type: 'anthropic' });
		expect(repo.get(p.id)).toBeDefined();

		const updated = repo.update(p.id, { name: 'anthropic-v2' });
		expect(updated.name).toBe('anthropic-v2');

		repo.delete(p.id);
		expect(repo.get(p.id)).toBeUndefined();
	});
});

// ── Model ────────────────────────────────────────────────────────────────────

describe('ModelRepo', () => {
	it('creates a model linked to provider', () => {
		const providers = new ProviderRepo(orm);
		const p = providers.create({ name: 'openai', type: 'openai' });

		const repo = new ModelRepo(orm);
		const m = repo.create({ name: 'gpt-4o', providerId: p.id, modelId: 'gpt-4o', params: { temperature: 0.7 } });
		expect(m.providerId).toBe(p.id);
		expect(m.modelId).toBe('gpt-4o');

		const all = repo.list();
		expect(all).toHaveLength(1);
	});

	it('cascades delete when provider is deleted', () => {
		const providers = new ProviderRepo(orm);
		const p = providers.create({ name: 'openai', type: 'openai' });
		const models = new ModelRepo(orm);
		models.create({ name: 'gpt-4o', providerId: p.id, modelId: 'gpt-4o' });

		providers.delete(p.id);
		expect(models.list()).toHaveLength(0);
	});
});

// ── Tool ─────────────────────────────────────────────────────────────────────

describe('ToolRepo', () => {
	it('CRUD cycle', () => {
		const repo = new ToolRepo(orm);
		const t = repo.create({
			name: 'web-search',
			description: 'Search the web',
			handlerType: 'builtin',
			handlerConfig: { name: 'web-search' },
			parametersSchema: { type: 'object' },
		});
		expect(t.name).toBe('web-search');

		const updated = repo.update(t.id, { description: 'Updated description' });
		expect(updated.description).toBe('Updated description');

		repo.delete(t.id);
		expect(repo.list()).toHaveLength(0);
	});
});

// ── MCP Server ───────────────────────────────────────────────────────────────

describe('McpServerRepo', () => {
	it('CRUD cycle', () => {
		const repo = new McpServerRepo(orm);
		const s = repo.create({ name: 'test-mcp', transport: 'stdio', handlerConfig: { command: 'node', args: ['server.js'] } });
		expect(s.name).toBe('test-mcp');
		expect(s.transport).toBe('stdio');

		const all = repo.list();
		expect(all).toHaveLength(1);

		repo.delete(s.id);
		expect(repo.list()).toHaveLength(0);
	});
});

// ── Agent ────────────────────────────────────────────────────────────────────

describe('AgentRepo', () => {
	it('creates agent with model reference', () => {
		const providers = new ProviderRepo(orm);
		const p = providers.create({ name: 'openai', type: 'openai' });
		const models = new ModelRepo(orm);
		const m = models.create({ name: 'gpt-4o', providerId: p.id, modelId: 'gpt-4o' });

		const repo = new AgentRepo(orm);
		const a = repo.create({
			name: 'assistant',
			description: 'A helpful assistant',
			modelId: m.id,
			systemPrompt: 'You are helpful.',
		});
		expect(a.name).toBe('assistant');
		expect(a.modelId).toBe(m.id);
	});
});

// ── Workflow ─────────────────────────────────────────────────────────────────

describe('WorkflowRepo', () => {
	it('CRUD cycle', () => {
		const repo = new WorkflowRepo(orm);
		const w = repo.create({
			name: 'test-workflow',
			description: 'A test workflow',
			type: 'sequential',
			nodes: [{ id: 'n1', type: 'agent', position: { x: 0, y: 0 }, data: {} }],
			edges: [{ id: 'e1', source: 'n1', target: 'end' }],
		});
		expect(w.name).toBe('test-workflow');
		expect(w.type).toBe('sequential');

		repo.delete(w.id);
		expect(repo.list()).toHaveLength(0);
	});
});

// ── Session ──────────────────────────────────────────────────────────────────

describe('SessionRepo', () => {
	it('creates session and tracks head message', () => {
		const repo = new SessionRepo(orm);
		const s = repo.create({ title: 'Test Chat', mode: 'chat' });
		expect(s.title).toBe('Test Chat');

		const got = repo.get(s.id);
		expect(got).toBeDefined();
		expect(got!.headMessageId).toBeUndefined();
	});

	it('CRUD and list', () => {
		const repo = new SessionRepo(orm);
		repo.create({ title: 'Chat 1' });
		repo.create({ title: 'Chat 2' });
		expect(repo.list()).toHaveLength(2);
	});

	it('manages session tools', () => {
		const sessions = new SessionRepo(orm);
		const tools = new ToolRepo(orm);

		const s = sessions.create({ title: 'Test' });
		const t1 = tools.create({ name: 'tool-1', description: 'A', parametersSchema: {}, handlerType: 'builtin', handlerConfig: {} });
		const t2 = tools.create({ name: 'tool-2', description: 'B', parametersSchema: {}, handlerType: 'builtin', handlerConfig: {} });

		sessions.setTools(s.id, [t1.id, t2.id] as any);
		const sessionTools = sessions.getTools(s.id);
		expect(sessionTools).toHaveLength(2);
	});
});

// ── Message ──────────────────────────────────────────────────────────────────

describe('MessageRepo', () => {
	it('creates messages in a DAG', () => {
		const sessions = new SessionRepo(orm);
		const s = sessions.create({ title: 'Test' });

		const repo = new MessageRepo(orm);
		const m1 = repo.create({
			sessionId: s.id,
			parentId: null,
			role: 'user',
			content: 'Hello',
		});
		expect(m1.role).toBe('user');
		expect(m1.parentId).toBeNull();

		const m2 = repo.create({
			sessionId: s.id,
			parentId: m1.id,
			role: 'assistant',
			content: 'Hi there!',
		});
		expect(m2.parentId).toBe(m1.id);

		const all = repo.listBySession(s.id);
		expect(all).toHaveLength(2);
	});

	it('resolves ancestry chain', () => {
		const sessions = new SessionRepo(orm);
		const s = sessions.create({ title: 'Test' });

		const repo = new MessageRepo(orm);
		const m1 = repo.create({ sessionId: s.id, parentId: null, role: 'user', content: 'A' });
		const m2 = repo.create({ sessionId: s.id, parentId: m1.id, role: 'assistant', content: 'B' });
		const m3 = repo.create({ sessionId: s.id, parentId: m2.id, role: 'user', content: 'C' });

		const ancestry = repo.getAncestry(m3.id);
		expect(ancestry).toHaveLength(3);
		expect(ancestry[0].id).toBe(m1.id);
		expect(ancestry[2].id).toBe(m3.id);
	});
});

// ── Execution ────────────────────────────────────────────────────────────────

describe('ExecutionRepo', () => {
	it('creates and updates status', () => {
		const repo = new ExecutionRepo(orm);
		const e = repo.create({ type: 'chat', input: 'test prompt' });
		expect(e.status).toBe('running');

		repo.updateStatus(e.id, 'completed', 'final output');
		const updated = repo.get(e.id);
		expect(updated!.status).toBe('completed');
		expect(updated!.finalOutput).toBe('final output');
	});
});

// ── StateNode ────────────────────────────────────────────────────────────────

describe('StateNodeRepo', () => {
	it('creates state nodes for execution', () => {
		const execs = new ExecutionRepo(orm);
		const e = execs.create({ type: 'chat', input: 'test' });

		const repo = new StateNodeRepo(orm);
		const n = repo.create({
			executionId: e.id,
			parentId: null,
			kind: 'agent_start',
		});
		expect(n.kind).toBe('agent_start');
		expect(n.status).toBe('running');

		repo.updateStatus(n.id, 'completed');
		expect(repo.get(n.id)!.status).toBe('completed');
	});
});

// ── WorkerRun ────────────────────────────────────────────────────────────────

describe('WorkerRunRepo', () => {
	it('creates and updates', () => {
		const execs = new ExecutionRepo(orm);
		const e = execs.create({ type: 'workflow', input: 'test' });

		const repo = new WorkerRunRepo(orm);
		const w = repo.create({ executionId: e.id });
		expect(w.status).toBe('starting');

		repo.updateStatus(w.id, 'running');
		expect(repo.get(w.id)!.status).toBe('running');
	});
});

// ── HitlWait ─────────────────────────────────────────────────────────────────

describe('HitlWaitRepo', () => {
	it('creates and resolves', () => {
		const execs = new ExecutionRepo(orm);
		const e = execs.create({ type: 'chat', input: 'test' });
		const nodes = new StateNodeRepo(orm);
		const n = nodes.create({ executionId: e.id, parentId: null, kind: 'hitl_pause' });

		const repo = new HitlWaitRepo(orm);
		const h = repo.create({ executionId: e.id, stateNodeId: n.id, toolContext: {}, runtimeSnapshot: {}, operatorInstructions: 'Please approve' });
		expect(h.status).toBe('pending');

		repo.resolve(h.id, 'approved', { response: 'User approved' });
		const resolved = repo.get(h.id);
		expect(resolved!.status).toBe('approved');
	});
});

// ── AuditEvent ───────────────────────────────────────────────────────────────

describe('AuditEventRepo', () => {
	it('creates audit events', () => {
		const repo = new AuditEventRepo(orm);
		repo.create({ kind: 'execution.start', executionId: 'test-exec' as any });
		repo.create({ kind: 'execution.complete', executionId: 'test-exec' as any });

		const all = repo.listByExecution('test-exec' as any);
		expect(all.length).toBeGreaterThanOrEqual(2);
	});
});

// ── Memory ───────────────────────────────────────────────────────────────────

describe('MemoryRepo', () => {
	it('CRUD cycle', () => {
		const repo = new MemoryRepo(orm);
		const m = repo.create({ content: 'Remember this fact.', topic: 'facts' });
		expect(m.content).toBe('Remember this fact.');

		const all = repo.list();
		expect(all).toHaveLength(1);

		repo.delete(m.id);
		expect(repo.list()).toHaveLength(0);
	});
});
