/**
 * MemoryRepo — Persistence for agent/session memory entries.
 */

import { eq, like, desc, or } from 'drizzle-orm';
import { aiMemoriesTable } from '../schema.js';
import { toJSON, now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type {
	MemoryId, AgentConfigId,
	MemoryEntry, CreateMemoryInput,
} from '../types.js';
import type { AiAgentOrm } from '../orm-type.js';
import type { IMemoryRepo, RepoListQuery } from './interfaces.js';
import { applyListQuery, createRowMapper, jsonOr, opt } from './query-helpers.js';

const mapMemory = createRowMapper<MemoryEntry>({
	id: (row) => row.id as MemoryId,
	sessionId: (row) => opt(row.session_id as MemoryEntry['sessionId'] | null),
	agentId: (row) => opt(row.agent_id as MemoryEntry['agentId'] | null),
	content: (row) => row.content as string,
	sourceType: (row) => opt(row.source_type as MemoryEntry['sourceType'] | null),
	importance: (row) => opt(row.importance as number | null),
	topic: (row) => opt(row.topic as string | null),
	entities: (row) => jsonOr<string[] | undefined>(row.entities, undefined),
	metadata: (row) => jsonOr<Record<string, unknown>>(row.metadata, {}),
	createdAt: (row) => row.created_at as string,
});

const memoryColumns = {
	id: aiMemoriesTable.id,
	sessionId: aiMemoriesTable.session_id,
	agentId: aiMemoriesTable.agent_id,
	content: aiMemoriesTable.content,
	sourceType: aiMemoriesTable.source_type,
	importance: aiMemoriesTable.importance,
	topic: aiMemoriesTable.topic,
	createdAt: aiMemoriesTable.created_at,
} as const;

export class MemoryRepo implements IMemoryRepo {
	constructor(private readonly orm: AiAgentOrm) {}

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

	list(agentId?: AgentConfigId, query?: RepoListQuery<keyof typeof memoryColumns>): MemoryEntry[] {
		let statement = this.orm.select().from(aiMemoriesTable).$dynamic();
		if (agentId) statement = statement.where(eq(aiMemoriesTable.agent_id, agentId));
		statement = statement.orderBy(desc(aiMemoriesTable.created_at));
		statement = applyListQuery(statement, memoryColumns, query);
		return (statement.all() as Record<string, unknown>[]).map(mapMemory);
	}

	search(query: string, options?: RepoListQuery<keyof typeof memoryColumns>): MemoryEntry[] {
		const pattern = `%${query}%`;
		let statement = this.orm.select().from(aiMemoriesTable)
			.where(or(
				like(aiMemoriesTable.content, pattern),
				like(aiMemoriesTable.topic, pattern),
			))
			.orderBy(desc(aiMemoriesTable.created_at));
		statement = applyListQuery(statement, memoryColumns, options);
		return (statement.all() as Record<string, unknown>[]).map(mapMemory);
	}

	delete(id: MemoryId): void {
		this.orm.delete(aiMemoriesTable).where(eq(aiMemoriesTable.id, id)).run();
	}

	private map(row: Record<string, unknown>): MemoryEntry {
		return mapMemory(row);
	}
}
