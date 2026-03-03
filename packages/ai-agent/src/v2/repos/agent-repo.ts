/**
 * AgentRepo — CRUD persistence for agent configurations.
 *
 * Manages the agent entity plus m2m join tables for tools and MCP servers.
 */

import { eq, asc } from 'drizzle-orm';
import type { RootDatabaseOrm } from '@orch/shared/db';
import {
	aiAgentsTable, aiAgentToolsTable, aiAgentMcpServersTable,
	aiToolsTable, aiMcpServersTable,
} from '../schema.js';
import { toJSON, fromJSON, now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type {
	AgentConfigId, AgentConfig, CreateAgentInput,
	ToolConfigId, ToolConfig, McpServerId, McpServerConfig,
} from '../types.js';
import type { IAgentRepo } from './interfaces.js';

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
			.all() as any[]).map(r => r.server_id);
		return this.map(row, mcpServerIds);
	}

	list(): AgentConfig[] {
		return (this.orm.select().from(aiAgentsTable).all() as any[]).map(row => {
			const mcpServerIds = (this.orm.select({ server_id: aiAgentMcpServersTable.server_id })
				.from(aiAgentMcpServersTable)
				.where(eq(aiAgentMcpServersTable.agent_id, row.id))
				.orderBy(asc(aiAgentMcpServersTable.sort_order))
				.all() as any[]).map(r => r.server_id);
			return this.map(row, mcpServerIds);
		});
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
		toolIds.forEach((toolId, i) => {
			this.orm.insert(aiAgentToolsTable).values({
				agent_id: agentId,
				tool_id: toolId,
				sort_order: i,
			}).run();
		});
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
		return rows.map(r => ({
			id: r.id,
			name: r.name,
			description: r.description,
			parametersSchema: fromJSON(r.parameters_schema) ?? {},
			handlerType: r.handler_type,
			handlerConfig: fromJSON(r.handler_config) ?? {},
			createdAt: r.created_at,
			updatedAt: r.updated_at,
		}));
	}

	setMcpServers(agentId: AgentConfigId, serverIds: McpServerId[]): void {
		this.orm.delete(aiAgentMcpServersTable).where(eq(aiAgentMcpServersTable.agent_id, agentId)).run();
		serverIds.forEach((serverId, i) => {
			this.orm.insert(aiAgentMcpServersTable).values({
				agent_id: agentId,
				server_id: serverId,
				sort_order: i,
			}).run();
		});
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
		return rows.map(r => ({
			id: r.id,
			name: r.name,
			protocolVersion: r.protocol_version ?? undefined,
			capabilities: fromJSON(r.capabilities) ?? [],
			transport: r.transport,
			handlerConfig: fromJSON(r.handler_config) ?? {},
			createdAt: r.created_at,
			updatedAt: r.updated_at,
		}));
	}

	private map(row: any, mcpServerIds: string[]): AgentConfig {
		return {
			id: row.id,
			name: row.name,
			description: row.description,
			modelId: row.model_id,
			systemPrompt: row.system_prompt,
			toolIds: fromJSON(row.tool_ids) ?? [],
			mcpServerIds: mcpServerIds.length ? mcpServerIds as McpServerId[] : undefined,
			params: fromJSON(row.params) ?? undefined,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}
}
