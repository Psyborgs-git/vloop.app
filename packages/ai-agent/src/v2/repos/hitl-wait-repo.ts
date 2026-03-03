/**
 * HitlWaitRepo — HITL (Human-in-the-Loop) wait persistence.
 *
 * Stores full tool context, runtime snapshot, and operator instructions
 * so that a paused execution can be fully rehydrated after human review.
 */

import { eq, and } from 'drizzle-orm';
import type { RootDatabaseOrm } from '@orch/shared/db';
import { aiHitlWaitsTable } from '../schema.js';
import { toJSON, fromJSON, now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type {
	HitlWaitId, ExecutionId,
	HitlWait, CreateHitlWaitInput, HitlWaitStatus,
} from '../types.js';
import type { IHitlWaitRepo } from './interfaces.js';

export class HitlWaitRepo implements IHitlWaitRepo {
	constructor(private readonly orm: RootDatabaseOrm) {}

	create(input: CreateHitlWaitInput): HitlWait {
		const id = generateId() as HitlWaitId;
		const ts = now();
		this.orm.insert(aiHitlWaitsTable).values({
			id,
			execution_id: input.executionId,
			state_node_id: input.stateNodeId,
			status: 'pending',
			tool_context: toJSON(input.toolContext),
			runtime_snapshot: toJSON(input.runtimeSnapshot),
			operator_instructions: input.operatorInstructions,
			user_response: null,
			created_at: ts,
			resolved_at: null,
		}).run();
		return this.get(id)!;
	}

	get(id: HitlWaitId): HitlWait | undefined {
		const row = this.orm.select().from(aiHitlWaitsTable)
			.where(eq(aiHitlWaitsTable.id, id)).get() as any;
		return row ? this.map(row) : undefined;
	}

	getByExecution(executionId: ExecutionId): HitlWait | undefined {
		const row = this.orm.select().from(aiHitlWaitsTable)
			.where(and(
				eq(aiHitlWaitsTable.execution_id, executionId),
				eq(aiHitlWaitsTable.status, 'pending'),
			))
			.limit(1)
			.get() as any;
		return row ? this.map(row) : undefined;
	}

	resolve(id: HitlWaitId, status: HitlWaitStatus, userResponse?: Record<string, unknown>): void {
		this.orm.update(aiHitlWaitsTable).set({
			status,
			user_response: userResponse ? toJSON(userResponse) : null,
			resolved_at: now(),
		}).where(eq(aiHitlWaitsTable.id, id)).run();
	}

	private map(row: any): HitlWait {
		return {
			id: row.id,
			executionId: row.execution_id,
			stateNodeId: row.state_node_id,
			status: row.status,
			toolContext: fromJSON(row.tool_context) ?? {},
			runtimeSnapshot: fromJSON(row.runtime_snapshot) ?? {},
			operatorInstructions: row.operator_instructions,
			userResponse: fromJSON(row.user_response),
			createdAt: row.created_at,
			resolvedAt: row.resolved_at ?? undefined,
		};
	}
}
