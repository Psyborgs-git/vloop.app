/**
 * StateNodeRepo — DAG-based execution step persistence.
 *
 * Each state node records an execution step with a parent_id forming a DAG.
 * Supports checkpoint snapshots for crash recovery and resume.
 */

import { eq, desc, asc, and } from 'drizzle-orm';
import type { RootDatabaseOrm } from '@orch/shared/db';
import { aiStateNodesTable } from '../schema.js';
import { toJSON, fromJSON, now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type {
	StateNodeId, ExecutionId, StateNode, CreateStateNodeInput,
	StateNodeStatus,
} from '../types.js';
import type { IStateNodeRepo } from './interfaces.js';

export class StateNodeRepo implements IStateNodeRepo {
	constructor(private readonly orm: RootDatabaseOrm) {}

	create(input: CreateStateNodeInput): StateNode {
		const id = generateId() as StateNodeId;
		const ts = now();
		this.orm.insert(aiStateNodesTable).values({
			id,
			execution_id: input.executionId,
			parent_id: input.parentId ?? null,
			kind: input.kind,
			status: input.status ?? 'running',
			payload: toJSON(input.payload ?? {}),
			checkpoint: toJSON(input.checkpoint),
			note: input.note ?? null,
			started_at: ts,
			completed_at: null,
		}).run();
		return this.get(id)!;
	}

	get(id: StateNodeId): StateNode | undefined {
		const row = this.orm.select().from(aiStateNodesTable)
			.where(eq(aiStateNodesTable.id, id)).get() as any;
		return row ? this.map(row) : undefined;
	}

	listByExecution(executionId: ExecutionId): StateNode[] {
		return (this.orm.select().from(aiStateNodesTable)
			.where(eq(aiStateNodesTable.execution_id, executionId))
			.orderBy(asc(aiStateNodesTable.started_at))
			.all() as any[]).map(r => this.map(r));
	}

	updateStatus(id: StateNodeId, status: StateNodeStatus, completedAt?: string): void {
		this.orm.update(aiStateNodesTable)
			.set({ status, completed_at: completedAt ?? (status === 'completed' || status === 'failed' ? now() : null) })
			.where(eq(aiStateNodesTable.id, id))
			.run();
	}

	updateCheckpoint(id: StateNodeId, checkpoint: Record<string, unknown>): void {
		this.orm.update(aiStateNodesTable)
			.set({ checkpoint: toJSON(checkpoint) })
			.where(eq(aiStateNodesTable.id, id))
			.run();
	}

	getAncestry(nodeId: StateNodeId): StateNode[] {
		const chain: StateNode[] = [];
		let current = this.get(nodeId);
		while (current) {
			chain.unshift(current);
			if (!current.parentId) break;
			current = this.get(current.parentId);
		}
		return chain;
	}

	getChildren(parentId: StateNodeId): StateNode[] {
		return (this.orm.select().from(aiStateNodesTable)
			.where(eq(aiStateNodesTable.parent_id, parentId))
			.orderBy(asc(aiStateNodesTable.started_at))
			.all() as any[]).map(r => this.map(r));
	}

	getLastCompleted(executionId: ExecutionId): StateNode | undefined {
		const row = this.orm.select().from(aiStateNodesTable)
			.where(and(
				eq(aiStateNodesTable.execution_id, executionId),
				eq(aiStateNodesTable.status, 'completed'),
			))
			.orderBy(desc(aiStateNodesTable.completed_at))
			.limit(1)
			.get() as any;
		return row ? this.map(row) : undefined;
	}

	// ── Mapping ──────────────────────────────────────────────────────────

	private map(row: any): StateNode {
		return {
			id: row.id,
			executionId: row.execution_id,
			parentId: row.parent_id ?? null,
			kind: row.kind,
			status: row.status,
			payload: fromJSON(row.payload) ?? {},
			checkpoint: fromJSON(row.checkpoint),
			note: row.note ?? undefined,
			startedAt: row.started_at,
			completedAt: row.completed_at ?? undefined,
		};
	}
}
