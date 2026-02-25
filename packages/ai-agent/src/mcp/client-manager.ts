import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Logger } from '@orch/daemon';
import type { McpServerConfig, McpServerId } from '../config/types.js';
import type { ToolDefinition } from '../tools.js';

export class McpClientManager {
    private clients = new Map<McpServerId, Client>();
    private transports = new Map<McpServerId, SSEClientTransport | StdioClientTransport>();

    constructor(private readonly logger: Logger) {}

    async connect(config: McpServerConfig): Promise<Client> {
        if (this.clients.has(config.id)) {
            return this.clients.get(config.id)!;
        }

        this.logger.info({ serverId: config.id, transport: config.transport }, 'Connecting to MCP server');

        let transport: SSEClientTransport | StdioClientTransport;

        if (config.transport === 'sse') {
            const url = config.handlerConfig.url as string;
            if (!url) throw new Error(`MCP server ${config.id} missing URL for SSE transport`);
            
            const headers = (config.handlerConfig.headers as Record<string, string>) || {};
            
            transport = new SSEClientTransport(new URL(url), {
                requestInit: {
                    headers
                }
            });
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

            transport = new StdioClientTransport({
                command,
                args,
                env: mergedEnv
            });
        } else {
            throw new Error(`Unsupported MCP transport: ${config.transport}`);
        }

        const client = new Client(
            {
                name: 'vloop-ai-agent',
                version: '1.0.0',
            },
            {
                capabilities: {},
            }
        );

        try {
            await client.connect(transport);
            this.clients.set(config.id, client);
            this.transports.set(config.id, transport);
            this.logger.info({ serverId: config.id }, 'Connected to MCP server');
            return client;
        } catch (err) {
            this.logger.error({ err, serverId: config.id }, 'Failed to connect to MCP server');
            throw err;
        }
    }

    async disconnect(serverId: McpServerId): Promise<void> {
        const client = this.clients.get(serverId);
        const transport = this.transports.get(serverId);
        
        if (client) {
            try {
                await client.close();
            } catch (err) {
                this.logger.warn({ err, serverId }, 'Error closing MCP client');
            }
            this.clients.delete(serverId);
        }
        
        if (transport) {
            try {
                await transport.close();
            } catch (err) {
                this.logger.warn({ err, serverId }, 'Error closing MCP transport');
            }
            this.transports.delete(serverId);
        }
    }

    async getTools(config: McpServerConfig): Promise<ToolDefinition[]> {
        const client = await this.connect(config);
        
        try {
            const response = await client.listTools();
            
            return response.tools.map(tool => ({
                name: `mcp_${config.name}_${tool.name}`,
                description: tool.description || '',
                parameters: tool.inputSchema as any,
                execute: async (args: any) => {
                    this.logger.debug({ serverId: config.id, tool: tool.name }, 'Executing MCP tool');
                    const result = await client.callTool({
                        name: tool.name,
                        arguments: args
                    });
                    
                    if (result.isError) {
                        throw new Error(`MCP tool error: ${JSON.stringify(result.content)}`);
                    }
                    
                    // Extract text content from result
                    const content = result.content as Array<{ type: string; text?: string }>;
                    const textContent = content
                        .filter(c => c.type === 'text' && c.text)
                        .map(c => c.text)
                        .join('\n');
                        
                    return textContent;
                }
            }));
        } catch (err) {
            this.logger.error({ err, serverId: config.id }, 'Failed to list MCP tools');
            return [];
        }
    }

    async disconnectAll(): Promise<void> {
        const serverIds = Array.from(this.clients.keys());
        await Promise.all(serverIds.map(id => this.disconnect(id)));
    }
}