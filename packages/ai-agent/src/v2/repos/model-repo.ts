/**
 * ModelRepo — CRUD persistence for AI models.
 */

import { eq } from 'drizzle-orm';
import type { RootDatabaseOrm } from '@orch/shared/db';
import { aiModelsTable } from '../schema.js';
import { toJSON, now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type { ModelId, ModelConfig, CreateModelInput } from '../types.js';
import type { IModelRepo, RepoListQuery } from './interfaces.js';
import { applyListQuery, createRowMapper, jsonOr, opt } from './query-helpers.js';

const mapModel = createRowMapper<ModelConfig>({
	id: (row) => row.id as ModelId,
	name: (row) => row.name as string,
	providerId: (row) => row.provider_id as ModelConfig['providerId'],
	modelId: (row) => row.model_id as string,
	runtime: (row) => opt(row.runtime as ModelConfig['runtime'] | null),
	supportsTools: (row) => Boolean(row.supports_tools),
	supportsStreaming: (row) => Boolean(row.supports_streaming),
	params: (row) => jsonOr<ModelConfig['params']>(row.params, {}),
	createdAt: (row) => row.created_at as string,
	updatedAt: (row) => row.updated_at as string,
});

const modelColumns = {
	id: aiModelsTable.id,
	name: aiModelsTable.name,
	providerId: aiModelsTable.provider_id,
	modelId: aiModelsTable.model_id,
	runtime: aiModelsTable.runtime,
	supportsTools: aiModelsTable.supports_tools,
	supportsStreaming: aiModelsTable.supports_streaming,
	createdAt: aiModelsTable.created_at,
	updatedAt: aiModelsTable.updated_at,
} as const;

export class ModelRepo implements IModelRepo {
	constructor(private readonly orm: RootDatabaseOrm) {}

	create(input: CreateModelInput): ModelConfig {
		const id = generateId() as ModelId;
		const ts = now();
		this.orm.insert(aiModelsTable).values({
			id,
			name: input.name,
			provider_id: input.providerId,
			model_id: input.modelId,
			runtime: input.runtime ?? null,
			supports_tools: input.supportsTools ? 1 : 0,
			supports_streaming: input.supportsStreaming ? 1 : 0,
			params: toJSON(input.params ?? {}),
			created_at: ts,
			updated_at: ts,
		}).run();
		return this.get(id)!;
	}

	get(id: ModelId): ModelConfig | undefined {
		const row = this.orm.select().from(aiModelsTable)
			.where(eq(aiModelsTable.id, id)).get() as any;
		return row ? this.map(row) : undefined;
	}

	list(query?: RepoListQuery<keyof typeof modelColumns>): ModelConfig[] {
		const statement = applyListQuery(this.orm.select().from(aiModelsTable), modelColumns, query);
		return (statement.all() as Record<string, unknown>[]).map(mapModel);
	}

	update(id: ModelId, input: Partial<CreateModelInput>): ModelConfig {
		const set: Record<string, any> = { updated_at: now() };
		if (input.name !== undefined) set.name = input.name;
		if (input.providerId !== undefined) set.provider_id = input.providerId;
		if (input.modelId !== undefined) set.model_id = input.modelId;
		if (input.runtime !== undefined) set.runtime = input.runtime;
		if (input.supportsTools !== undefined) set.supports_tools = input.supportsTools ? 1 : 0;
		if (input.supportsStreaming !== undefined) set.supports_streaming = input.supportsStreaming ? 1 : 0;
		if (input.params !== undefined) set.params = toJSON(input.params);
		this.orm.update(aiModelsTable).set(set).where(eq(aiModelsTable.id, id)).run();
		return this.get(id)!;
	}

	delete(id: ModelId): void {
		this.orm.delete(aiModelsTable).where(eq(aiModelsTable.id, id)).run();
	}

	private map(row: Record<string, unknown>): ModelConfig {
		return mapModel(row);
	}
}
