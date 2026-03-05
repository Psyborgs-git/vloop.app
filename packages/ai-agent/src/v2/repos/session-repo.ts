/**
 * SessionRepo — CRUD persistence for chat sessions (v2 DAG-aware).
 *
 * Sessions own a head_message_id pointer into the message DAG,
 * plus m2m join tables for tools and MCP servers.
 */

import { eq, asc, inArray } from 'drizzle-orm';
import {
	aiSessionsTable, aiSessionToolsTable, aiSessionMcpServersTable,
	aiToolsTable, aiMcpServersTable,
} from '../schema.js';
import { now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type {
	SessionId, Session, CreateSessionInput,
	MessageId, ToolConfigId, ToolConfig,
	McpServerId, McpServerConfig,
} from '../types.js';
import type { AiAgentOrm } from '../orm-type.js';
import type { ISessionRepo, RepoListQuery } from './interfaces.js';
import { applyListQuery, createRowMapper, jsonOr, opt } from './query-helpers.js';

const mapSession = createRowMapper<Session>({
	id: (row) => row.id as SessionId,
	agentId: (row) => opt(row.agent_id as Session['agentId'] | null),
	workflowId: (row) => opt(row.workflow_id as Session['workflowId'] | null),
	modelId: (row) => opt(row.model_id as Session['modelId'] | null),
	providerId: (row) => opt(row.provider_id as Session['providerId'] | null),
	mode: (row) => opt(row.mode as Session['mode'] | null),
	title: (row) => row.title as string,
	toolIds: () => [],
	mcpServerIds: () => undefined,
	headMessageId: (row) => opt(row.head_message_id as MessageId | null),
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

const sessionColumns = {
	id: aiSessionsTable.id,
	agentId: aiSessionsTable.agent_id,
	workflowId: aiSessionsTable.workflow_id,
	modelId: aiSessionsTable.model_id,
	providerId: aiSessionsTable.provider_id,
	mode: aiSessionsTable.mode,
	title: aiSessionsTable.title,
	headMessageId: aiSessionsTable.head_message_id,
	createdAt: aiSessionsTable.created_at,
	updatedAt: aiSessionsTable.updated_at,
} as const;

export class SessionRepo implements ISessionRepo {
	constructor(private readonly orm: AiAgentOrm) {}

	create(input: CreateSessionInput): Session {
		const id = generateId() as SessionId;
		const ts = now();
		this.orm.insert(aiSessionsTable).values({
			id,
			agent_id: input.agentId ?? null,
			workflow_id: input.workflowId ?? null,
			model_id: input.modelId ?? null,
			provider_id: input.providerId ?? null,
			mode: input.mode ?? null,
			title: input.title ?? 'New Chat',
			head_message_id: null,
			created_at: ts,
			updated_at: ts,
		}).run();
		if (input.toolIds?.length) this.setTools(id, input.toolIds);
		if (input.mcpServerIds?.length) this.setMcpServers(id, input.mcpServerIds);
		return this.get(id)!;
	}

	get(id: SessionId): Session | undefined {
		const relationalRow = this.orm.query?.aiSessionsTable?.findFirst?.({
			where: eq(aiSessionsTable.id, id),
			with: {
				sessionTools: true,
				sessionMcpServers: true,
			},
		})?.sync() as unknown as
			| (Record<string, unknown> & {
					sessionTools?: Array<{ tool_id: ToolConfigId; sort_order: number | null }>;
					sessionMcpServers?: Array<{ server_id: McpServerId; sort_order: number | null }>;
			  })
			| undefined;

		if (relationalRow) {
			const toolIds = (relationalRow.sessionTools ?? [])
				.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
				.map((row) => row.tool_id);
			const mcpServerIds = (relationalRow.sessionMcpServers ?? [])
				.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
				.map((row) => row.server_id);
			return this.map(relationalRow, toolIds, mcpServerIds);
		}

		const row = this.orm.select().from(aiSessionsTable)
			.where(eq(aiSessionsTable.id, id)).get() as any;
		if (!row) return undefined;
		const toolIds = this.getToolIds(id);
		const mcpServerIds = this.getMcpServerIds(id);
		return this.map(row, toolIds, mcpServerIds);
	}

	list(query?: RepoListQuery<keyof typeof sessionColumns>): Session[] {
		const statement = applyListQuery(this.orm.select().from(aiSessionsTable), sessionColumns, query);
		const rows = statement.all() as Record<string, unknown>[];
		if (!rows.length) return [];

		const eagerRelations = query?.relationLoad !== 'lazy';
		const sessionIds = rows.map((row) => row.id as SessionId);
		const toolMap = eagerRelations ? this.getToolIdsBySessionIds(sessionIds) : new Map<SessionId, ToolConfigId[]>();
		const mcpMap = eagerRelations ? this.getMcpServerIdsBySessionIds(sessionIds) : new Map<SessionId, McpServerId[]>();

		return rows.map((row) => this.map(
			row,
			toolMap.get(row.id as SessionId) ?? [],
			mcpMap.get(row.id as SessionId) ?? [],
		));
	}

	update(id: SessionId, input: Partial<CreateSessionInput>): Session {
		const set: Record<string, any> = { updated_at: now() };
		if (input.agentId !== undefined) set.agent_id = input.agentId;
		if (input.workflowId !== undefined) set.workflow_id = input.workflowId;
		if (input.modelId !== undefined) set.model_id = input.modelId;
		if (input.providerId !== undefined) set.provider_id = input.providerId;
		if (input.mode !== undefined) set.mode = input.mode;
		if (input.title !== undefined) set.title = input.title;
		if (input.toolIds !== undefined) this.setTools(id, input.toolIds);
		if (input.mcpServerIds !== undefined) this.setMcpServers(id, input.mcpServerIds);
		this.orm.update(aiSessionsTable).set(set).where(eq(aiSessionsTable.id, id)).run();
		return this.get(id)!;
	}

	delete(id: SessionId): void {
		this.orm.delete(aiSessionToolsTable).where(eq(aiSessionToolsTable.session_id, id)).run();
		this.orm.delete(aiSessionMcpServersTable).where(eq(aiSessionMcpServersTable.session_id, id)).run();
		this.orm.delete(aiSessionsTable).where(eq(aiSessionsTable.id, id)).run();
	}

	setHeadMessage(sessionId: SessionId, messageId: MessageId): void {
		this.orm.update(aiSessionsTable)
			.set({ head_message_id: messageId, updated_at: now() })
			.where(eq(aiSessionsTable.id, sessionId))
			.run();
	}

	setTools(sessionId: SessionId, toolIds: ToolConfigId[]): void {
		this.orm.delete(aiSessionToolsTable).where(eq(aiSessionToolsTable.session_id, sessionId)).run();
		if (!toolIds.length) return;
		this.orm.insert(aiSessionToolsTable).values(
			toolIds.map((toolId, i) => ({
				session_id: sessionId,
				tool_id: toolId,
				sort_order: i,
			})),
		).run();
	}

	getTools(sessionId: SessionId): ToolConfig[] {
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
			.from(aiSessionToolsTable)
			.innerJoin(aiToolsTable, eq(aiSessionToolsTable.tool_id, aiToolsTable.id))
			.where(eq(aiSessionToolsTable.session_id, sessionId))
			.orderBy(asc(aiSessionToolsTable.sort_order))
			.all() as any[];
		return rows.map((r) => mapTool(r as Record<string, unknown>));
	}

	setMcpServers(sessionId: SessionId, serverIds: McpServerId[]): void {
		this.orm.delete(aiSessionMcpServersTable).where(eq(aiSessionMcpServersTable.session_id, sessionId)).run();
		if (!serverIds.length) return;
		this.orm.insert(aiSessionMcpServersTable).values(
			serverIds.map((serverId, i) => ({
				session_id: sessionId,
				server_id: serverId,
				sort_order: i,
			})),
		).run();
	}

	getMcpServers(sessionId: SessionId): McpServerConfig[] {
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
			.from(aiSessionMcpServersTable)
			.innerJoin(aiMcpServersTable, eq(aiSessionMcpServersTable.server_id, aiMcpServersTable.id))
			.where(eq(aiSessionMcpServersTable.session_id, sessionId))
			.orderBy(asc(aiSessionMcpServersTable.sort_order))
			.all() as any[];
		return rows.map((r) => mapMcpServer(r as Record<string, unknown>));
	}

	// ── Internal ─────────────────────────────────────────────────────────

	private getToolIds(sessionId: string): ToolConfigId[] {
		return (this.orm.select({ tool_id: aiSessionToolsTable.tool_id })
			.from(aiSessionToolsTable)
			.where(eq(aiSessionToolsTable.session_id, sessionId))
			.orderBy(asc(aiSessionToolsTable.sort_order))
			.all() as any[]).map(r => r.tool_id);
	}

	private getMcpServerIds(sessionId: string): McpServerId[] {
		return (this.orm.select({ server_id: aiSessionMcpServersTable.server_id })
			.from(aiSessionMcpServersTable)
			.where(eq(aiSessionMcpServersTable.session_id, sessionId))
			.orderBy(asc(aiSessionMcpServersTable.sort_order))
			.all() as any[]).map(r => r.server_id);
	}

	private getToolIdsBySessionIds(sessionIds: SessionId[]): Map<SessionId, ToolConfigId[]> {
		if (!sessionIds.length) return new Map();
		const rows = this.orm.select({
			session_id: aiSessionToolsTable.session_id,
			tool_id: aiSessionToolsTable.tool_id,
		})
			.from(aiSessionToolsTable)
			.where(inArray(aiSessionToolsTable.session_id, sessionIds))
			.orderBy(asc(aiSessionToolsTable.sort_order))
			.all() as Array<{ session_id: SessionId; tool_id: ToolConfigId }>;

		const grouped = new Map<SessionId, ToolConfigId[]>();
		for (const row of rows) {
			const list = grouped.get(row.session_id) ?? [];
			list.push(row.tool_id);
			grouped.set(row.session_id, list);
		}
		return grouped;
	}

	private getMcpServerIdsBySessionIds(sessionIds: SessionId[]): Map<SessionId, McpServerId[]> {
		if (!sessionIds.length) return new Map();
		const rows = this.orm.select({
			session_id: aiSessionMcpServersTable.session_id,
			server_id: aiSessionMcpServersTable.server_id,
		})
			.from(aiSessionMcpServersTable)
			.where(inArray(aiSessionMcpServersTable.session_id, sessionIds))
			.orderBy(asc(aiSessionMcpServersTable.sort_order))
			.all() as Array<{ session_id: SessionId; server_id: McpServerId }>;

		const grouped = new Map<SessionId, McpServerId[]>();
		for (const row of rows) {
			const list = grouped.get(row.session_id) ?? [];
			list.push(row.server_id);
			grouped.set(row.session_id, list);
		}
		return grouped;
	}

	private map(row: Record<string, unknown>, toolIds: ToolConfigId[], mcpServerIds: McpServerId[]): Session {
		const base = mapSession(row);
		return {
			...base,
			toolIds,
			mcpServerIds: mcpServerIds.length ? mcpServerIds : undefined,
		};
	}
}
