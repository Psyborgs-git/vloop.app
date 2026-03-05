/**
 * WorkerRunRepo — Persistence for worker thread run lifecycle.
 */

import { eq } from 'drizzle-orm';
import { aiWorkerRunsTable } from '../schema.js';
import { now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type {
	WorkerRunId, WorkerRun, CreateWorkerRunInput, WorkerRunStatus,
} from '../types.js';
import type { AiAgentOrm } from '../orm-type.js';
import type { IWorkerRunRepo } from './interfaces.js';

export class WorkerRunRepo implements IWorkerRunRepo {
	constructor(private readonly orm: AiAgentOrm) {}

	create(input: CreateWorkerRunInput): WorkerRun {
		const id = generateId() as WorkerRunId;
		const ts = now();
		this.orm.insert(aiWorkerRunsTable).values({
			id,
			execution_id: input.executionId,
			thread_id: input.threadId ?? null,
			status: 'starting',
			error: null,
			started_at: ts,
			completed_at: null,
		}).run();
		return this.get(id)!;
	}

	get(id: WorkerRunId): WorkerRun | undefined {
		const row = this.orm.select().from(aiWorkerRunsTable)
			.where(eq(aiWorkerRunsTable.id, id)).get() as any;
		return row ? this.map(row) : undefined;
	}

	updateStatus(id: WorkerRunId, status: WorkerRunStatus, error?: string): void {
		const set: Record<string, any> = { status };
		if (error !== undefined) set.error = error;
		if (status === 'completed' || status === 'failed' || status === 'terminated') {
			set.completed_at = now();
		}
		this.orm.update(aiWorkerRunsTable).set(set).where(eq(aiWorkerRunsTable.id, id)).run();
	}

	private map(row: any): WorkerRun {
		return {
			id: row.id,
			executionId: row.execution_id,
			threadId: row.thread_id ?? undefined,
			status: row.status,
			error: row.error ?? undefined,
			startedAt: row.started_at,
			completedAt: row.completed_at ?? undefined,
		};
	}
}
