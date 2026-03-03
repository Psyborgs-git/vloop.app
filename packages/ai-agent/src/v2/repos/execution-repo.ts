/**
 * ExecutionRepo — CRUD persistence for workflow/chat executions.
 */

import { eq, desc } from 'drizzle-orm';
import type { RootDatabaseOrm } from '@orch/shared/db';
import { aiExecutionsTable } from '../schema.js';
import { now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type {
	ExecutionId, SessionId, WorkflowId, StateNodeId, WorkerRunId,
	Execution, CreateExecutionInput, ExecutionStatus,
} from '../types.js';
import type { IExecutionRepo } from './interfaces.js';

export class ExecutionRepo implements IExecutionRepo {
	constructor(private readonly orm: RootDatabaseOrm) {}

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

	listBySession(sessionId: SessionId): Execution[] {
		return (this.orm.select().from(aiExecutionsTable)
			.where(eq(aiExecutionsTable.session_id, sessionId))
			.orderBy(desc(aiExecutionsTable.started_at))
			.all() as any[]).map(r => this.map(r));
	}

	listByWorkflow(workflowId: WorkflowId): Execution[] {
		return (this.orm.select().from(aiExecutionsTable)
			.where(eq(aiExecutionsTable.workflow_id, workflowId))
			.orderBy(desc(aiExecutionsTable.started_at))
			.all() as any[]).map(r => this.map(r));
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

	private map(row: any): Execution {
		return {
			id: row.id,
			type: row.type,
			sessionId: row.session_id ?? undefined,
			workflowId: row.workflow_id ?? undefined,
			agentId: row.agent_id ?? undefined,
			status: row.status,
			input: row.input,
			finalOutput: row.final_output ?? undefined,
			lastCheckpointId: row.last_checkpoint_id ?? undefined,
			workerRunId: row.worker_run_id ?? undefined,
			startedAt: row.started_at,
			completedAt: row.completed_at ?? undefined,
		};
	}
}
