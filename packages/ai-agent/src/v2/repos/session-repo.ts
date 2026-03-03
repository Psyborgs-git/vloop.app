/**
 * SessionRepo — CRUD persistence for chat sessions (v2 DAG-aware).
 *
 * Sessions own a head_message_id pointer into the message DAG,
 * plus m2m join tables for tools and MCP servers.
 */

import { eq, asc } from 'drizzle-orm';
import type { RootDatabaseOrm } from '@orch/shared/db';
import {
	aiSessionsTable, aiSessionToolsTable, aiSessionMcpServersTable,
	aiToolsTable, aiMcpServersTable,
} from '../schema.js';
import { fromJSON, now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type {
	SessionId, Session, CreateSessionInput,
	MessageId, ToolConfigId, ToolConfig,
	McpServerId, McpServerConfig,
} from '../types.js';
import type { ISessionRepo } from './interfaces.js';

export class SessionRepo implements ISessionRepo {
	constructor(private readonly orm: RootDatabaseOrm) {}

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
		const row = this.orm.select().from(aiSessionsTable)
			.where(eq(aiSessionsTable.id, id)).get() as any;
		if (!row) return undefined;
		const toolIds = this.getToolIds(id);
		const mcpServerIds = this.getMcpServerIds(id);
		return this.map(row, toolIds, mcpServerIds);
	}

	list(): Session[] {
		return (this.orm.select().from(aiSessionsTable).all() as any[]).map(row => {
			const toolIds = this.getToolIds(row.id);
			const mcpServerIds = this.getMcpServerIds(row.id);
			return this.map(row, toolIds, mcpServerIds);
		});
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
		toolIds.forEach((toolId, i) => {
			this.orm.insert(aiSessionToolsTable).values({
				session_id: sessionId,
				tool_id: toolId,
				sort_order: i,
			}).run();
		});
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

	setMcpServers(sessionId: SessionId, serverIds: McpServerId[]): void {
		this.orm.delete(aiSessionMcpServersTable).where(eq(aiSessionMcpServersTable.session_id, sessionId)).run();
		serverIds.forEach((serverId, i) => {
			this.orm.insert(aiSessionMcpServersTable).values({
				session_id: sessionId,
				server_id: serverId,
				sort_order: i,
			}).run();
		});
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

	private map(row: any, toolIds: ToolConfigId[], mcpServerIds: McpServerId[]): Session {
		return {
			id: row.id,
			agentId: row.agent_id ?? undefined,
			workflowId: row.workflow_id ?? undefined,
			modelId: row.model_id ?? undefined,
			providerId: row.provider_id ?? undefined,
			mode: row.mode ?? undefined,
			title: row.title,
			toolIds,
			mcpServerIds: mcpServerIds.length ? mcpServerIds : undefined,
			headMessageId: row.head_message_id ?? undefined,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}
}
