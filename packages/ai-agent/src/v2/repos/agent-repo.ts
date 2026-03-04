/**
 * AgentRepo — CRUD persistence for agent configurations.
 *
 * Manages the agent entity plus m2m join tables for tools and MCP servers.
 */

import { eq, asc, inArray } from 'drizzle-orm';
import type { RootDatabaseOrm } from '@orch/shared/db';
import {
	aiAgentsTable, aiAgentToolsTable, aiAgentMcpServersTable,
	aiToolsTable, aiMcpServersTable,
} from '../schema.js';
import { toJSON, now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type {
	AgentConfigId, AgentConfig, CreateAgentInput,
	ToolConfigId, ToolConfig, McpServerId, McpServerConfig,
} from '../types.js';
import type { IAgentRepo, RepoListQuery } from './interfaces.js';
import { applyListQuery, createRowMapper, jsonOr, opt } from './query-helpers.js';

const mapAgent = createRowMapper<AgentConfig>({
	id: (row) => row.id as AgentConfigId,
	name: (row) => row.name as string,
	description: (row) => row.description as string,
	modelId: (row) => row.model_id as AgentConfig['modelId'],
	systemPrompt: (row) => row.system_prompt as string,
	toolIds: (row) => jsonOr<ToolConfigId[]>(row.tool_ids, []),
	mcpServerIds: () => undefined,
	params: (row) => jsonOr<AgentConfig['params']>(row.params, undefined),
	createdAt: (row) => row.created_at as string,
	updatedAt: (row) => row.updated_at as string,
});

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

const agentColumns = {
	id: aiAgentsTable.id,
	name: aiAgentsTable.name,
	description: aiAgentsTable.description,
	modelId: aiAgentsTable.model_id,
	createdAt: aiAgentsTable.created_at,
	updatedAt: aiAgentsTable.updated_at,
} as const;

export class AgentRepo implements IAgentRepo {
	constructor(private readonly orm: RootDatabaseOrm) {}

	create(input: CreateAgentInput): AgentConfig {
		const id = generateId() as AgentConfigId;
		const ts = now();
		this.orm.insert(aiAgentsTable).values({
			id,
			name: input.name,
			description: input.description ?? '',
			model_id: input.modelId,
			system_prompt: input.systemPrompt ?? '',
			tool_ids: toJSON(input.toolIds ?? []),
			params: toJSON(input.params ?? {}),
			created_at: ts,
			updated_at: ts,
		}).run();
		if (input.toolIds?.length) this.setTools(id, input.toolIds);
		if (input.mcpServerIds?.length) this.setMcpServers(id, input.mcpServerIds);
		return this.get(id)!;
	}

	get(id: AgentConfigId): AgentConfig | undefined {
		const row = this.orm.select().from(aiAgentsTable)
			.where(eq(aiAgentsTable.id, id)).get() as any;
		if (!row) return undefined;
		const mcpServerIds = (this.orm.select({ server_id: aiAgentMcpServersTable.server_id })
			.from(aiAgentMcpServersTable)
			.where(eq(aiAgentMcpServersTable.agent_id, id))
			.orderBy(asc(aiAgentMcpServersTable.sort_order))
			.all() as Array<{ server_id: McpServerId }>).map(r => r.server_id);
		return this.map(row, mcpServerIds);
	}

	list(query?: RepoListQuery<keyof typeof agentColumns>): AgentConfig[] {
		const statement = applyListQuery(this.orm.select().from(aiAgentsTable), agentColumns, query);
		const rows = statement.all() as Record<string, unknown>[];
		if (!rows.length) return [];

		const eagerRelations = query?.relationLoad !== 'lazy';
		const relationMap = eagerRelations
			? this.getMcpServerIdsByAgentIds(rows.map((row) => row.id as AgentConfigId))
			: new Map<AgentConfigId, McpServerId[]>();

		return rows.map((row) => this.map(row, relationMap.get(row.id as AgentConfigId) ?? []));
	}

	update(id: AgentConfigId, input: Partial<CreateAgentInput>): AgentConfig {
		const set: Record<string, any> = { updated_at: now() };
		if (input.name !== undefined) set.name = input.name;
		if (input.description !== undefined) set.description = input.description;
		if (input.modelId !== undefined) set.model_id = input.modelId;
		if (input.systemPrompt !== undefined) set.system_prompt = input.systemPrompt;
		if (input.params !== undefined) set.params = toJSON(input.params);
		if (input.toolIds !== undefined) {
			set.tool_ids = toJSON(input.toolIds);
			this.setTools(id, input.toolIds);
		}
		if (input.mcpServerIds !== undefined) this.setMcpServers(id, input.mcpServerIds);
		this.orm.update(aiAgentsTable).set(set).where(eq(aiAgentsTable.id, id)).run();
		return this.get(id)!;
	}

	delete(id: AgentConfigId): void {
		this.orm.delete(aiAgentToolsTable).where(eq(aiAgentToolsTable.agent_id, id)).run();
		this.orm.delete(aiAgentMcpServersTable).where(eq(aiAgentMcpServersTable.agent_id, id)).run();
		this.orm.delete(aiAgentsTable).where(eq(aiAgentsTable.id, id)).run();
	}

	setTools(agentId: AgentConfigId, toolIds: ToolConfigId[]): void {
		this.orm.delete(aiAgentToolsTable).where(eq(aiAgentToolsTable.agent_id, agentId)).run();
		if (!toolIds.length) return;
		this.orm.insert(aiAgentToolsTable).values(
			toolIds.map((toolId, i) => ({
				agent_id: agentId,
				tool_id: toolId,
				sort_order: i,
			})),
		).run();
	}

	getTools(agentId: AgentConfigId): ToolConfig[] {
		const rows = this.orm.select({
			id: aiToolsTable.id,
			name: aiToolsTable.name,
			description: aiToolsTable.description,
			parameters_schema: aiToolsTable.parameters_schema,
			handler_type: aiToolsTable.handler_type,
			handler_config: aiToolsTable.handler_config,
			created_at: aiToolsTable.created_at,
			updated_at: aiToolsTable.updated_at,
		})
			.from(aiAgentToolsTable)
			.innerJoin(aiToolsTable, eq(aiAgentToolsTable.tool_id, aiToolsTable.id))
			.where(eq(aiAgentToolsTable.agent_id, agentId))
			.orderBy(asc(aiAgentToolsTable.sort_order))
			.all() as any[];
		return rows.map((r) => mapTool(r as Record<string, unknown>));
	}

	setMcpServers(agentId: AgentConfigId, serverIds: McpServerId[]): void {
		this.orm.delete(aiAgentMcpServersTable).where(eq(aiAgentMcpServersTable.agent_id, agentId)).run();
		if (!serverIds.length) return;
		this.orm.insert(aiAgentMcpServersTable).values(
			serverIds.map((serverId, i) => ({
				agent_id: agentId,
				server_id: serverId,
				sort_order: i,
			})),
		).run();
	}

	getMcpServers(agentId: AgentConfigId): McpServerConfig[] {
		const rows = this.orm.select({
			id: aiMcpServersTable.id,
			name: aiMcpServersTable.name,
			protocol_version: aiMcpServersTable.protocol_version,
			capabilities: aiMcpServersTable.capabilities,
			transport: aiMcpServersTable.transport,
			handler_config: aiMcpServersTable.handler_config,
			created_at: aiMcpServersTable.created_at,
			updated_at: aiMcpServersTable.updated_at,
		})
			.from(aiAgentMcpServersTable)
			.innerJoin(aiMcpServersTable, eq(aiAgentMcpServersTable.server_id, aiMcpServersTable.id))
			.where(eq(aiAgentMcpServersTable.agent_id, agentId))
			.orderBy(asc(aiAgentMcpServersTable.sort_order))
			.all() as any[];
		return rows.map((r) => mapMcpServer(r as Record<string, unknown>));
	}

	private getMcpServerIdsByAgentIds(agentIds: AgentConfigId[]): Map<AgentConfigId, McpServerId[]> {
		if (!agentIds.length) return new Map();
		const rows = this.orm.select({
			agent_id: aiAgentMcpServersTable.agent_id,
			server_id: aiAgentMcpServersTable.server_id,
		})
			.from(aiAgentMcpServersTable)
			.where(inArray(aiAgentMcpServersTable.agent_id, agentIds))
			.orderBy(asc(aiAgentMcpServersTable.sort_order))
			.all() as Array<{ agent_id: AgentConfigId; server_id: McpServerId }>;

		const grouped = new Map<AgentConfigId, McpServerId[]>();
		for (const row of rows) {
			const list = grouped.get(row.agent_id) ?? [];
			list.push(row.server_id);
			grouped.set(row.agent_id, list);
		}
		return grouped;
	}

	private map(row: Record<string, unknown>, mcpServerIds: McpServerId[]): AgentConfig {
		const base = mapAgent(row);
		return {
			...base,
			mcpServerIds: mcpServerIds.length ? mcpServerIds : undefined,
		};
	}
}
