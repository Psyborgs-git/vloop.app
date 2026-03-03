/**
 * ToolRepo — CRUD persistence for AI tool definitions.
 */

import { eq } from 'drizzle-orm';
import type { RootDatabaseOrm } from '@orch/shared/db';
import { aiToolsTable } from '../schema.js';
import { toJSON, fromJSON, now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type { ToolConfigId, ToolConfig, CreateToolInput } from '../types.js';
import type { IToolRepo } from './interfaces.js';

export class ToolRepo implements IToolRepo {
	constructor(private readonly orm: RootDatabaseOrm) {}

	create(input: CreateToolInput): ToolConfig {
		const id = generateId() as ToolConfigId;
		const ts = now();
		this.orm.insert(aiToolsTable).values({
			id,
			name: input.name,
			description: input.description,
			parameters_schema: toJSON(input.parametersSchema),
			handler_type: input.handlerType,
			handler_config: toJSON(input.handlerConfig),
			created_at: ts,
			updated_at: ts,
		}).run();
		return this.get(id)!;
	}

	get(id: ToolConfigId): ToolConfig | undefined {
		const row = this.orm.select().from(aiToolsTable)
			.where(eq(aiToolsTable.id, id)).get() as any;
		return row ? this.map(row) : undefined;
	}

	list(): ToolConfig[] {
		return (this.orm.select().from(aiToolsTable).all() as any[]).map(r => this.map(r));
	}

	update(id: ToolConfigId, input: Partial<CreateToolInput>): ToolConfig {
		const set: Record<string, any> = { updated_at: now() };
		if (input.name !== undefined) set.name = input.name;
		if (input.description !== undefined) set.description = input.description;
		if (input.parametersSchema !== undefined) set.parameters_schema = toJSON(input.parametersSchema);
		if (input.handlerType !== undefined) set.handler_type = input.handlerType;
		if (input.handlerConfig !== undefined) set.handler_config = toJSON(input.handlerConfig);
		this.orm.update(aiToolsTable).set(set).where(eq(aiToolsTable.id, id)).run();
		return this.get(id)!;
	}

	delete(id: ToolConfigId): void {
		this.orm.delete(aiToolsTable).where(eq(aiToolsTable.id, id)).run();
	}

	private map(row: any): ToolConfig {
		return {
			id: row.id,
			name: row.name,
			description: row.description,
			parametersSchema: fromJSON(row.parameters_schema) ?? {},
			handlerType: row.handler_type,
			handlerConfig: fromJSON(row.handler_config) ?? {},
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}
}
