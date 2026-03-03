/**
 * MCPManager — Dynamic MCP tool injection driven by junction tables.
 *
 * - Connects to MCP servers lazily (on first tool fetch).
 * - Resolves agent/session MCP server IDs via repos → config → connect → tools.
 * - Returns ADK FunctionTool[] ready to inject into LlmAgent.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { FunctionTool } from '@google/adk';
import type { Logger } from '@orch/daemon';
import type { IMcpServerRepo } from './repos/interfaces.js';
import type { McpServerId, McpServerConfig } from './types.js';

export class MCPManager {
	private clients = new Map<McpServerId, Client>();
	private transports = new Map<McpServerId, SSEClientTransport | StdioClientTransport>();

	constructor(
		private readonly mcpServerRepo: IMcpServerRepo,
		private readonly logger: Logger,
	) {}

	/**
	 * Resolve a list of MCP server IDs into ADK FunctionTool[].
	 * Connects lazily. Tool names are prefixed: mcp_{serverName}_{toolName}.
	 */
	async resolveFunctionTools(serverIds: McpServerId[]): Promise<FunctionTool[]> {
		const nested = await Promise.all(serverIds.map(async (serverId) => {
			const config = this.mcpServerRepo.get(serverId);
			if (!config) {
				this.logger.warn({ serverId }, 'MCPManager: server config not found, skipping');
				return [];
			}
			try {
				return await this.getToolsForServer(config);
			} catch (err) {
				this.logger.error({ err, serverId }, 'MCPManager: failed to resolve tools');
				return [];
			}
		}));
		return nested.flat();
	}

	async disconnect(serverId: McpServerId): Promise<void> {
		const client = this.clients.get(serverId);
		const transport = this.transports.get(serverId);
		if (client) {
			try { await client.close(); } catch { /* swallow */ }
			this.clients.delete(serverId);
		}
		if (transport) {
			try { await transport.close(); } catch { /* swallow */ }
			this.transports.delete(serverId);
		}
	}

	async disconnectAll(): Promise<void> {
		await Promise.all(Array.from(this.clients.keys()).map(id => this.disconnect(id)));
	}

	// ── Private ──────────────────────────────────────────────────────────

	private async connect(config: McpServerConfig): Promise<Client> {
		if (this.clients.has(config.id)) return this.clients.get(config.id)!;

		let transport: SSEClientTransport | StdioClientTransport;

		if (config.transport === 'sse') {
			const url = config.handlerConfig.url as string;
			if (!url) throw new Error(`MCP server ${config.id} missing URL for SSE transport`);
			const headers = (config.handlerConfig.headers as Record<string, string>) || {};
			transport = new SSEClientTransport(new URL(url), { requestInit: { headers } });
		} else if (config.transport === 'stdio') {
			const command = config.handlerConfig.command as string;
			if (!command) throw new Error(`MCP server ${config.id} missing command for stdio transport`);
			const args = (config.handlerConfig.args as string[]) || [];
			const env = (config.handlerConfig.env as Record<string, string>) || {};
			const mergedEnv: Record<string, string> = {};
			for (const [k, v] of Object.entries(process.env)) {
				if (v !== undefined) mergedEnv[k] = v;
			}
			for (const [k, v] of Object.entries(env)) {
				mergedEnv[k] = v;
			}
			transport = new StdioClientTransport({ command, args, env: mergedEnv });
		} else {
			throw new Error(`Unsupported MCP transport: ${config.transport}`);
		}

		const client = new Client({ name: 'vloop-ai-agent', version: '1.0.0' }, { capabilities: {} });
		await client.connect(transport);
		this.clients.set(config.id, client);
		this.transports.set(config.id, transport);
		this.logger.info({ serverId: config.id }, 'MCPManager: connected');
		return client;
	}

	private async getToolsForServer(config: McpServerConfig): Promise<FunctionTool[]> {
		const client = await this.connect(config);
		const response = await client.listTools();
		return response.tools.map(tool => new FunctionTool({
			name: `mcp_${config.name}_${tool.name}`,
			description: tool.description || '',
			parameters: tool.inputSchema as any,
			execute: async (args: any) => {
				this.logger.debug({ serverId: config.id, tool: tool.name }, 'MCPManager: executing tool');
				const result = await client.callTool({ name: tool.name, arguments: args });
				if (result.isError) throw new Error(`MCP tool error: ${JSON.stringify(result.content)}`);
				const content = result.content as Array<{ type: string; text?: string }>;
				return content.filter(c => c.type === 'text' && c.text).map(c => c.text).join('\n');
			},
		}));
	}
}
