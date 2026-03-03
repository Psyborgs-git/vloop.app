/**
 * MessageRepo — DAG-based message persistence.
 *
 * Every message has a parent_id forming a directed acyclic graph.
 * Branching: a retry/rewind creates a new child under the historical parent,
 * producing a fork without destroying the original lineage.
 */

import { eq, asc } from 'drizzle-orm';
import type { RootDatabaseOrm } from '@orch/shared/db';
import { aiMessagesTable } from '../schema.js';
import { toJSON, fromJSON, now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type {
	MessageId, SessionId, Message, CreateMessageInput,
} from '../types.js';
import type { IMessageRepo } from './interfaces.js';

export class MessageRepo implements IMessageRepo {
	constructor(private readonly orm: RootDatabaseOrm) {}

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

	listBySession(sessionId: SessionId): Message[] {
		return (this.orm.select().from(aiMessagesTable)
			.where(eq(aiMessagesTable.session_id, sessionId))
			.orderBy(asc(aiMessagesTable.created_at))
			.all() as any[]).map(r => this.map(r));
	}

	getAncestry(messageId: MessageId): Message[] {
		const chain: Message[] = [];
		let current = this.get(messageId);
		while (current) {
			chain.unshift(current);
			if (!current.parentId) break;
			current = this.get(current.parentId);
		}
		return chain;
	}

	getChildren(parentId: MessageId): Message[] {
		return (this.orm.select().from(aiMessagesTable)
			.where(eq(aiMessagesTable.parent_id, parentId))
			.orderBy(asc(aiMessagesTable.created_at))
			.all() as any[]).map(r => this.map(r));
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

	private map(row: any): Message {
		return {
			id: row.id,
			sessionId: row.session_id,
			parentId: row.parent_id ?? null,
			branch: row.branch,
			role: row.role,
			content: row.content,
			toolCalls: fromJSON(row.tool_calls),
			toolResults: fromJSON(row.tool_results),
			providerType: row.provider_type ?? undefined,
			modelId: row.model_id ?? undefined,
			finishReason: row.finish_reason ?? undefined,
			usage: fromJSON(row.usage),
			latencyMs: row.latency_ms ?? undefined,
			metadata: fromJSON(row.metadata),
			createdAt: row.created_at,
		};
	}
}
