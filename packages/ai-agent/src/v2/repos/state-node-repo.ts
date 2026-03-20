/**
 * StateNodeRepo — DAG-based execution step persistence.
 *
 * Each state node records an execution step with a parent_id forming a DAG.
 * Supports checkpoint snapshots for crash recovery and resume.
 */

import { eq, desc, asc, and, sql } from 'drizzle-orm';
import { aiStateNodesTable } from '../schema.js';
import { toJSON, now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type {
	StateNodeId, ExecutionId, StateNode, CreateStateNodeInput,
	StateNodeStatus,
} from '../types.js';
import type { AiAgentOrm } from '../orm-type.js';
import type { IStateNodeRepo, RepoListQuery } from './interfaces.js';
import { applyListQuery, createRowMapper, jsonOr, opt } from './query-helpers.js';

const mapStateNode = createRowMapper<StateNode>({
	id: (row) => row.id as StateNodeId,
	executionId: (row) => row.execution_id as ExecutionId,
	parentId: (row) => (row.parent_id as StateNodeId | null) ?? null,
	kind: (row) => row.kind as StateNode['kind'],
	status: (row) => row.status as StateNodeStatus,
	payload: (row) => jsonOr<Record<string, unknown>>(row.payload, {}),
	checkpoint: (row) => jsonOr<Record<string, unknown> | undefined>(row.checkpoint, undefined),
	note: (row) => opt(row.note as string | null),
	startedAt: (row) => row.started_at as string,
	completedAt: (row) => opt(row.completed_at as string | null),
});

const stateNodeColumns = {
	id: aiStateNodesTable.id,
	executionId: aiStateNodesTable.execution_id,
	parentId: aiStateNodesTable.parent_id,
	kind: aiStateNodesTable.kind,
	status: aiStateNodesTable.status,
	startedAt: aiStateNodesTable.started_at,
	completedAt: aiStateNodesTable.completed_at,
} as const;

export class StateNodeRepo implements IStateNodeRepo {
	constructor(private readonly orm: AiAgentOrm) {}

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

	listByExecution(executionId: ExecutionId, query?: RepoListQuery<keyof typeof stateNodeColumns>): StateNode[] {
		let statement = this.orm.select().from(aiStateNodesTable)
			.where(eq(aiStateNodesTable.execution_id, executionId))
			.orderBy(asc(aiStateNodesTable.started_at));
		statement = applyListQuery(statement, stateNodeColumns, query);
		return (statement.all() as Record<string, unknown>[]).map(mapStateNode);
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
		// Optimized: Replaces N+1 SELECT queries with a single Recursive CTE query.
		// Builds the chain from leaf to root using parent_id, then maps to objects and reverses
		// to maintain the expected root-to-leaf array order.
		const query = sql`
			WITH RECURSIVE ancestry AS (
				SELECT * FROM ${aiStateNodesTable} WHERE id = ${nodeId}
				UNION ALL
				SELECT t.* FROM ${aiStateNodesTable} t
				INNER JOIN ancestry a ON t.id = a.parent_id
			)
			SELECT * FROM ancestry
		`;
		const rows = this.orm.all(query) as Record<string, unknown>[];
		return rows.map(mapStateNode).reverse();
	}

	getChildren(parentId: StateNodeId): StateNode[] {
		return (this.orm.select().from(aiStateNodesTable)
			.where(eq(aiStateNodesTable.parent_id, parentId))
			.orderBy(asc(aiStateNodesTable.started_at))
			.all() as Record<string, unknown>[]).map(mapStateNode);
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

	private map(row: Record<string, unknown>): StateNode {
		return mapStateNode(row);
	}
}
