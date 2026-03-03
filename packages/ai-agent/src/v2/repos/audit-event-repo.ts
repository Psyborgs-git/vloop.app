/**
 * AuditEventRepo — Append-only audit trail for execution events.
 */

import { eq, desc } from 'drizzle-orm';
import type { RootDatabaseOrm } from '@orch/shared/db';
import { aiAuditEventsTable } from '../schema.js';
import { toJSON, fromJSON, now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type {
	ExecutionId, AuditEventId,
	AuditEvent, CreateAuditEventInput,
} from '../types.js';
import type { IAuditEventRepo } from './interfaces.js';

export class AuditEventRepo implements IAuditEventRepo {
	constructor(private readonly orm: RootDatabaseOrm) {}

	create(input: CreateAuditEventInput): AuditEvent {
		const id = generateId() as AuditEventId;
		const ts = now();
		this.orm.insert(aiAuditEventsTable).values({
			id,
			execution_id: input.executionId ?? null,
			kind: input.kind,
			payload: toJSON(input.payload ?? {}),
			created_at: ts,
		}).run();
		return { id, executionId: input.executionId, kind: input.kind, payload: input.payload ?? {}, createdAt: ts };
	}

	listByExecution(executionId: ExecutionId): AuditEvent[] {
		return (this.orm.select().from(aiAuditEventsTable)
			.where(eq(aiAuditEventsTable.execution_id, executionId))
			.orderBy(desc(aiAuditEventsTable.created_at))
			.all() as any[]).map(r => this.map(r));
	}

	private map(row: any): AuditEvent {
		return {
			id: row.id,
			executionId: row.execution_id ?? undefined,
			kind: row.kind,
			payload: fromJSON(row.payload) ?? {},
			createdAt: row.created_at,
		};
	}
}
