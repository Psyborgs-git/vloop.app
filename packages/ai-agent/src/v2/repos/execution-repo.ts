/**
 * ExecutionRepo — CRUD persistence for workflow/chat executions.
 */

import { eq, desc } from 'drizzle-orm';
import { aiExecutionsTable } from '../schema.js';
import { now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type {
	ExecutionId, SessionId, WorkflowId, StateNodeId, WorkerRunId,
	Execution, CreateExecutionInput, ExecutionStatus,
} from '../types.js';
import type { AiAgentOrm } from '../orm-type.js';
import type { IExecutionRepo, RepoListQuery } from './interfaces.js';
import { applyListQuery, createRowMapper, opt } from './query-helpers.js';

const mapExecution = createRowMapper<Execution>({
	id: (row) => row.id as ExecutionId,
	type: (row) => row.type as Execution['type'],
	sessionId: (row) => opt(row.session_id as SessionId | null),
	workflowId: (row) => opt(row.workflow_id as WorkflowId | null),
	agentId: (row) => opt(row.agent_id as Execution['agentId'] | null),
	status: (row) => row.status as ExecutionStatus,
	input: (row) => row.input as string,
	finalOutput: (row) => opt(row.final_output as string | null),
	lastCheckpointId: (row) => opt(row.last_checkpoint_id as StateNodeId | null),
	workerRunId: (row) => opt(row.worker_run_id as WorkerRunId | null),
	startedAt: (row) => row.started_at as string,
	completedAt: (row) => opt(row.completed_at as string | null),
});

const executionColumns = {
	id: aiExecutionsTable.id,
	type: aiExecutionsTable.type,
	sessionId: aiExecutionsTable.session_id,
	workflowId: aiExecutionsTable.workflow_id,
	agentId: aiExecutionsTable.agent_id,
	status: aiExecutionsTable.status,
	startedAt: aiExecutionsTable.started_at,
	completedAt: aiExecutionsTable.completed_at,
} as const;

export class ExecutionRepo implements IExecutionRepo {
	constructor(private readonly orm: AiAgentOrm) {}

	create(input: CreateExecutionInput): Execution {
		const id = generateId() as ExecutionId;
		const ts = now();
		this.orm.insert(aiExecutionsTable).values({
			id,
			type: input.type,
			session_id: input.sessionId ?? null,
			workflow_id: input.workflowId ?? null,
			agent_id: input.agentId ?? null,
			status: 'running',
			input: input.input,
			final_output: null,
			last_checkpoint_id: null,
			worker_run_id: null,
			started_at: ts,
			completed_at: null,
		}).run();
		return this.get(id)!;
	}

	get(id: ExecutionId): Execution | undefined {
		const row = this.orm.select().from(aiExecutionsTable)
			.where(eq(aiExecutionsTable.id, id)).get() as any;
		return row ? this.map(row) : undefined;
	}

	listBySession(sessionId: SessionId, query?: RepoListQuery<keyof typeof executionColumns>): Execution[] {
		let statement = this.orm.select().from(aiExecutionsTable)
			.where(eq(aiExecutionsTable.session_id, sessionId))
			.orderBy(desc(aiExecutionsTable.started_at));
		statement = applyListQuery(statement, executionColumns, query);
		return (statement.all() as Record<string, unknown>[]).map(mapExecution);
	}

	listByWorkflow(workflowId: WorkflowId, query?: RepoListQuery<keyof typeof executionColumns>): Execution[] {
		let statement = this.orm.select().from(aiExecutionsTable)
			.where(eq(aiExecutionsTable.workflow_id, workflowId))
			.orderBy(desc(aiExecutionsTable.started_at));
		statement = applyListQuery(statement, executionColumns, query);
		return (statement.all() as Record<string, unknown>[]).map(mapExecution);
	}

	updateStatus(id: ExecutionId, status: ExecutionStatus, finalOutput?: string): void {
		const set: Record<string, any> = { status };
		if (finalOutput !== undefined) set.final_output = finalOutput;
		if (status === 'completed' || status === 'failed' || status === 'cancelled') {
			set.completed_at = now();
		}
		this.orm.update(aiExecutionsTable).set(set).where(eq(aiExecutionsTable.id, id)).run();
	}

	setLastCheckpoint(id: ExecutionId, stateNodeId: StateNodeId): void {
		this.orm.update(aiExecutionsTable)
			.set({ last_checkpoint_id: stateNodeId })
			.where(eq(aiExecutionsTable.id, id))
			.run();
	}

	setWorkerRun(id: ExecutionId, workerRunId: WorkerRunId): void {
		this.orm.update(aiExecutionsTable)
			.set({ worker_run_id: workerRunId })
			.where(eq(aiExecutionsTable.id, id))
			.run();
	}

	private map(row: Record<string, unknown>): Execution {
		return mapExecution(row);
	}
}
