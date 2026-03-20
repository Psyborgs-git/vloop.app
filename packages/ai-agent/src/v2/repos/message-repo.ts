/**
 * MessageRepo — DAG-based message persistence.
 *
 * Every message has a parent_id forming a directed acyclic graph.
 * Branching: a retry/rewind creates a new child under the historical parent,
 * producing a fork without destroying the original lineage.
 */

import { eq, asc, sql } from 'drizzle-orm';
import { aiMessagesTable } from '../schema.js';
import { toJSON, now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type {
	MessageId, SessionId, Message, CreateMessageInput,
} from '../types.js';
import type { AiAgentOrm } from '../orm-type.js';
import type { IMessageRepo, RepoListQuery } from './interfaces.js';
import { applyListQuery, createRowMapper, jsonOr, opt } from './query-helpers.js';

const mapMessage = createRowMapper<Message>({
	id: (row) => row.id as MessageId,
	sessionId: (row) => row.session_id as SessionId,
	parentId: (row) => (row.parent_id as MessageId | null) ?? null,
	branch: (row) => row.branch as string,
	role: (row) => row.role as Message['role'],
	content: (row) => row.content as string,
	toolCalls: (row) => jsonOr<any[] | undefined>(row.tool_calls, undefined),
	toolResults: (row) => jsonOr<any[] | undefined>(row.tool_results, undefined),
	providerType: (row) => opt(row.provider_type as Message['providerType'] | null),
	modelId: (row) => opt(row.model_id as string | null),
	finishReason: (row) => opt(row.finish_reason as string | null),
	usage: (row) => jsonOr<Message['usage']>(row.usage, undefined),
	latencyMs: (row) => opt(row.latency_ms as number | null),
	metadata: (row) => jsonOr<Record<string, unknown> | undefined>(row.metadata, undefined),
	createdAt: (row) => row.created_at as string,
});

const messageColumns = {
	id: aiMessagesTable.id,
	sessionId: aiMessagesTable.session_id,
	parentId: aiMessagesTable.parent_id,
	branch: aiMessagesTable.branch,
	role: aiMessagesTable.role,
	providerType: aiMessagesTable.provider_type,
	modelId: aiMessagesTable.model_id,
	finishReason: aiMessagesTable.finish_reason,
	latencyMs: aiMessagesTable.latency_ms,
	createdAt: aiMessagesTable.created_at,
} as const;

export class MessageRepo implements IMessageRepo {
	constructor(private readonly orm: AiAgentOrm) {}

	create(input: CreateMessageInput): Message {
		const id = generateId() as MessageId;
		const ts = now();
		this.orm.insert(aiMessagesTable).values({
			id,
			session_id: input.sessionId,
			parent_id: input.parentId ?? null,
			branch: input.branch ?? 'main',
			role: input.role,
			content: input.content,
			tool_calls: toJSON(input.toolCalls),
			tool_results: toJSON(input.toolResults),
			provider_type: input.providerType ?? null,
			model_id: input.modelId ?? null,
			finish_reason: input.finishReason ?? null,
			usage: toJSON(input.usage),
			latency_ms: input.latencyMs ?? null,
			metadata: toJSON(input.metadata),
			created_at: ts,
		}).run();
		return this.get(id)!;
	}

	get(id: MessageId): Message | undefined {
		const row = this.orm.select().from(aiMessagesTable)
			.where(eq(aiMessagesTable.id, id)).get() as any;
		return row ? this.map(row) : undefined;
	}

	listBySession(sessionId: SessionId, query?: RepoListQuery<keyof typeof messageColumns>): Message[] {
		let statement = this.orm.select().from(aiMessagesTable)
			.where(eq(aiMessagesTable.session_id, sessionId))
			.orderBy(asc(aiMessagesTable.created_at));
		statement = applyListQuery(statement, messageColumns, query);
		return (statement.all() as Record<string, unknown>[]).map(mapMessage);
	}

	getAncestry(messageId: MessageId): Message[] {
		// Optimized: Replaces N+1 SELECT queries with a single Recursive CTE query.
		// Builds the chain from leaf to root using parent_id, then maps to objects and reverses
		// to maintain the expected root-to-leaf array order.
		const query = sql`
			WITH RECURSIVE ancestry AS (
				SELECT * FROM ${aiMessagesTable} WHERE id = ${messageId}
				UNION ALL
				SELECT t.* FROM ${aiMessagesTable} t
				INNER JOIN ancestry a ON t.id = a.parent_id
			)
			SELECT * FROM ancestry
		`;
		const rows = this.orm.all(query) as Record<string, unknown>[];
		return rows.map(mapMessage).reverse();
	}

	getChildren(parentId: MessageId): Message[] {
		return (this.orm.select().from(aiMessagesTable)
			.where(eq(aiMessagesTable.parent_id, parentId))
			.orderBy(asc(aiMessagesTable.created_at))
			.all() as Record<string, unknown>[]).map(mapMessage);
	}

	getLinearChain(leafId: MessageId): Message[] {
		return this.getAncestry(leafId);
	}

	listBranches(sessionId: SessionId): string[] {
		const rows = this.orm
			.selectDistinct({ branch: aiMessagesTable.branch })
			.from(aiMessagesTable)
			.where(eq(aiMessagesTable.session_id, sessionId))
			.all() as Array<{ branch: string }>;
		return rows.map(r => r.branch);
	}

	// ── Mapping ──────────────────────────────────────────────────────────

	private map(row: Record<string, unknown>): Message {
		return mapMessage(row);
	}
}
