/**
 * AuditEventRepo — Append-only audit trail for execution events.
 */

import { eq, desc } from 'drizzle-orm';
import type { RootDatabaseOrm } from '@orch/shared/db';
import { aiAuditEventsTable } from '../schema.js';
import { toJSON, now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type {
	ExecutionId, AuditEventId,
	AuditEvent, CreateAuditEventInput,
} from '../types.js';
import type { IAuditEventRepo, RepoListQuery } from './interfaces.js';
import { applyListQuery, createRowMapper, jsonOr, opt } from './query-helpers.js';

const mapAuditEvent = createRowMapper<AuditEvent>({
	id: (row) => row.id as AuditEventId,
	executionId: (row) => opt(row.execution_id as ExecutionId | null),
	kind: (row) => row.kind as AuditEvent['kind'],
	payload: (row) => jsonOr<Record<string, unknown>>(row.payload, {}),
	createdAt: (row) => row.created_at as string,
});

const auditColumns = {
	id: aiAuditEventsTable.id,
	executionId: aiAuditEventsTable.execution_id,
	kind: aiAuditEventsTable.kind,
	createdAt: aiAuditEventsTable.created_at,
} as const;

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

	listByExecution(executionId: ExecutionId, query?: RepoListQuery<keyof typeof auditColumns>): AuditEvent[] {
		let statement = this.orm.select().from(aiAuditEventsTable)
			.where(eq(aiAuditEventsTable.execution_id, executionId))
			.orderBy(desc(aiAuditEventsTable.created_at));
		statement = applyListQuery(statement, auditColumns, query);
		return (statement.all() as Record<string, unknown>[]).map(mapAuditEvent);
	}

	private map(row: Record<string, unknown>): AuditEvent {
		return mapAuditEvent(row);
	}
}
