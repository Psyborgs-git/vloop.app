/**
 * MemoryRepo — Persistence for agent/session memory entries.
 */

import { eq, like, desc, or } from 'drizzle-orm';
import type { RootDatabaseOrm } from '@orch/shared/db';
import { aiMemoriesTable } from '../schema.js';
import { toJSON, fromJSON, now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type {
	MemoryId, AgentConfigId,
	MemoryEntry, CreateMemoryInput,
} from '../types.js';
import type { IMemoryRepo } from './interfaces.js';

export class MemoryRepo implements IMemoryRepo {
	constructor(private readonly orm: RootDatabaseOrm) {}

	create(input: CreateMemoryInput): MemoryEntry {
		const id = generateId() as MemoryId;
		const ts = now();
		this.orm.insert(aiMemoriesTable).values({
			id,
			session_id: input.sessionId ?? null,
			agent_id: input.agentId ?? null,
			content: input.content,
			source_type: input.sourceType ?? null,
			importance: input.importance ?? null,
			topic: input.topic ?? null,
			entities: toJSON(input.entities),
			metadata: toJSON(input.metadata ?? {}),
			created_at: ts,
		}).run();
		return this.get(id)!;
	}

	get(id: MemoryId): MemoryEntry | undefined {
		const row = this.orm.select().from(aiMemoriesTable)
			.where(eq(aiMemoriesTable.id, id)).get() as any;
		return row ? this.map(row) : undefined;
	}

	list(agentId?: AgentConfigId): MemoryEntry[] {
		if (agentId) {
			return (this.orm.select().from(aiMemoriesTable)
				.where(eq(aiMemoriesTable.agent_id, agentId))
				.orderBy(desc(aiMemoriesTable.created_at))
				.all() as any[]).map(r => this.map(r));
		}
		return (this.orm.select().from(aiMemoriesTable)
			.orderBy(desc(aiMemoriesTable.created_at))
			.all() as any[]).map(r => this.map(r));
	}

	search(query: string): MemoryEntry[] {
		const pattern = `%${query}%`;
		return (this.orm.select().from(aiMemoriesTable)
			.where(or(
				like(aiMemoriesTable.content, pattern),
				like(aiMemoriesTable.topic, pattern),
			))
			.orderBy(desc(aiMemoriesTable.created_at))
			.all() as any[]).map(r => this.map(r));
	}

	delete(id: MemoryId): void {
		this.orm.delete(aiMemoriesTable).where(eq(aiMemoriesTable.id, id)).run();
	}

	private map(row: any): MemoryEntry {
		return {
			id: row.id,
			sessionId: row.session_id ?? undefined,
			agentId: row.agent_id ?? undefined,
			content: row.content,
			sourceType: row.source_type ?? undefined,
			importance: row.importance ?? undefined,
			topic: row.topic ?? undefined,
			entities: fromJSON(row.entities),
			metadata: fromJSON(row.metadata) ?? {},
			createdAt: row.created_at,
		};
	}
}
