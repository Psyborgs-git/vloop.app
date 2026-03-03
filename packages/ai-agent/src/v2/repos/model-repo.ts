/**
 * ModelRepo — CRUD persistence for AI models.
 */

import { eq } from 'drizzle-orm';
import type { RootDatabaseOrm } from '@orch/shared/db';
import { aiModelsTable } from '../schema.js';
import { toJSON, fromJSON, now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type { ModelId, ModelConfig, CreateModelInput } from '../types.js';
import type { IModelRepo } from './interfaces.js';

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

	list(): ModelConfig[] {
		return (this.orm.select().from(aiModelsTable).all() as any[]).map(r => this.map(r));
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

	private map(row: any): ModelConfig {
		return {
			id: row.id,
			name: row.name,
			providerId: row.provider_id,
			modelId: row.model_id,
			runtime: row.runtime ?? undefined,
			supportsTools: Boolean(row.supports_tools),
			supportsStreaming: Boolean(row.supports_streaming),
			params: fromJSON(row.params) ?? {},
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}
}
