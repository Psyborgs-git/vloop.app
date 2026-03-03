/**
 * McpServerRepo — CRUD persistence for MCP server configurations.
 */

import { eq } from 'drizzle-orm';
import type { RootDatabaseOrm } from '@orch/shared/db';
import { aiMcpServersTable } from '../schema.js';
import { toJSON, fromJSON, now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type { McpServerId, McpServerConfig, CreateMcpServerInput } from '../types.js';
import type { IMcpServerRepo } from './interfaces.js';

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

	list(): McpServerConfig[] {
		return (this.orm.select().from(aiMcpServersTable).all() as any[]).map(r => this.map(r));
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

	private map(row: any): McpServerConfig {
		return {
			id: row.id,
			name: row.name,
			protocolVersion: row.protocol_version ?? undefined,
			capabilities: fromJSON(row.capabilities) ?? [],
			transport: row.transport,
			handlerConfig: fromJSON(row.handler_config) ?? {},
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}
}
