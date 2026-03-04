/**
 * ToolRepo — CRUD persistence for AI tool definitions.
 */

import { eq } from 'drizzle-orm';
import type { RootDatabaseOrm } from '@orch/shared/db';
import { aiToolsTable } from '../schema.js';
import { toJSON, now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type { ToolConfigId, ToolConfig, CreateToolInput } from '../types.js';
import type { IToolRepo, RepoListQuery } from './interfaces.js';
import { applyListQuery, createRowMapper, jsonOr } from './query-helpers.js';

const mapTool = createRowMapper<ToolConfig>({
	id: (row) => row.id as ToolConfigId,
	name: (row) => row.name as string,
	description: (row) => row.description as string,
	parametersSchema: (row) => jsonOr<Record<string, unknown>>(row.parameters_schema, {}),
	handlerType: (row) => row.handler_type as ToolConfig['handlerType'],
	handlerConfig: (row) => jsonOr<Record<string, unknown>>(row.handler_config, {}),
	createdAt: (row) => row.created_at as string,
	updatedAt: (row) => row.updated_at as string,
});

const toolColumns = {
	id: aiToolsTable.id,
	name: aiToolsTable.name,
	description: aiToolsTable.description,
	handlerType: aiToolsTable.handler_type,
	createdAt: aiToolsTable.created_at,
	updatedAt: aiToolsTable.updated_at,
} as const;

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

	list(query?: RepoListQuery<keyof typeof toolColumns>): ToolConfig[] {
		const statement = applyListQuery(this.orm.select().from(aiToolsTable), toolColumns, query);
		return (statement.all() as Record<string, unknown>[]).map(mapTool);
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

	private map(row: Record<string, unknown>): ToolConfig {
		return mapTool(row);
	}
}
