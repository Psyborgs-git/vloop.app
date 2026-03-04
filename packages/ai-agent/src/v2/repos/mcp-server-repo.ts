/**
 * McpServerRepo — CRUD persistence for MCP server configurations.
 */

import { eq } from 'drizzle-orm';
import type { RootDatabaseOrm } from '@orch/shared/db';
import { aiMcpServersTable } from '../schema.js';
import { toJSON, now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type { McpServerId, McpServerConfig, CreateMcpServerInput } from '../types.js';
import type { IMcpServerRepo, RepoListQuery } from './interfaces.js';
import { applyListQuery, createRowMapper, jsonOr, opt } from './query-helpers.js';

const mapMcpServer = createRowMapper<McpServerConfig>({
	id: (row) => row.id as McpServerId,
	name: (row) => row.name as string,
	protocolVersion: (row) => opt(row.protocol_version as string | null),
	capabilities: (row) => jsonOr<string[]>(row.capabilities, []),
	transport: (row) => row.transport as McpServerConfig['transport'],
	handlerConfig: (row) => jsonOr<Record<string, unknown>>(row.handler_config, {}),
	createdAt: (row) => row.created_at as string,
	updatedAt: (row) => row.updated_at as string,
});

const mcpColumns = {
	id: aiMcpServersTable.id,
	name: aiMcpServersTable.name,
	protocolVersion: aiMcpServersTable.protocol_version,
	transport: aiMcpServersTable.transport,
	createdAt: aiMcpServersTable.created_at,
	updatedAt: aiMcpServersTable.updated_at,
} as const;

export class McpServerRepo implements IMcpServerRepo {
	constructor(private readonly orm: RootDatabaseOrm) {}

	create(input: CreateMcpServerInput): McpServerConfig {
		const id = generateId() as McpServerId;
		const ts = now();
		this.orm.insert(aiMcpServersTable).values({
			id,
			name: input.name,
			protocol_version: input.protocolVersion ?? null,
			capabilities: toJSON(input.capabilities ?? []),
			transport: input.transport,
			handler_config: toJSON(input.handlerConfig),
			created_at: ts,
			updated_at: ts,
		}).run();
		return this.get(id)!;
	}

	get(id: McpServerId): McpServerConfig | undefined {
		const row = this.orm.select().from(aiMcpServersTable)
			.where(eq(aiMcpServersTable.id, id)).get() as any;
		return row ? this.map(row) : undefined;
	}

	list(query?: RepoListQuery<keyof typeof mcpColumns>): McpServerConfig[] {
		const statement = applyListQuery(this.orm.select().from(aiMcpServersTable), mcpColumns, query);
		return (statement.all() as Record<string, unknown>[]).map(mapMcpServer);
	}

	update(id: McpServerId, input: Partial<CreateMcpServerInput>): McpServerConfig {
		const set: Record<string, any> = { updated_at: now() };
		if (input.name !== undefined) set.name = input.name;
		if (input.protocolVersion !== undefined) set.protocol_version = input.protocolVersion;
		if (input.capabilities !== undefined) set.capabilities = toJSON(input.capabilities);
		if (input.transport !== undefined) set.transport = input.transport;
		if (input.handlerConfig !== undefined) set.handler_config = toJSON(input.handlerConfig);
		this.orm.update(aiMcpServersTable).set(set).where(eq(aiMcpServersTable.id, id)).run();
		return this.get(id)!;
	}

	delete(id: McpServerId): void {
		this.orm.delete(aiMcpServersTable).where(eq(aiMcpServersTable.id, id)).run();
	}

	private map(row: Record<string, unknown>): McpServerConfig {
		return mapMcpServer(row);
	}
}
