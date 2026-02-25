import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from '@orch/daemon';
import type { SessionManager } from '@orch/auth';
import type { ToolRegistry } from '@orch/ai-agent';

export function createMcpHttpHandler(
    toolRegistry: ToolRegistry,
    sessionManager: SessionManager,
    logger: Logger
): express.Express {
    const app = express();
    
    // Create MCP Server
    const server = new Server(
        {
            name: 'vloop-local-mcp',
            version: '1.0.0',
        },
        {
            capabilities: {
                tools: {},
            },
        }
    );

    // Register tools
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        const tools = toolRegistry.list();
        return {
            tools: tools.map(t => ({
                name: t.name,
                description: t.description || '',
                inputSchema: t.parameters || { type: 'object', properties: {} }
            }))
        };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const tool = toolRegistry.get(request.params.name);
        if (!tool) {
            throw new Error(`Tool not found: ${request.params.name}`);
        }

        try {
            // We don't have a full HandlerContext here, but we can pass a minimal one
            // if the tool needs it. For now, we just pass the arguments.
            const result = await tool.execute!(request.params.arguments);
            
            return {
                content: [
                    {
                        type: 'text',
                        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
                    }
                ]
            };
        } catch (err: any) {
            logger.error({ err, tool: request.params.name }, 'Error executing MCP tool');
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error: ${err.message}`
                    }
                ],
                isError: true
            };
        }
    });

    // Auth middleware
    const authMiddleware = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const authHeader = req.headers.authorization;
        const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : (req.query.token as string);

        if (!token) {
            res.status(401).json({ error: 'Unauthorized: Missing token' });
            return;
        }

        try {
            const session = await sessionManager.validate(token);
            if (!session) {
                res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
                return;
            }
            // Attach session to request if needed
            (req as any).session = session;
            next();
        } catch (err) {
            logger.error({ err }, 'Error validating MCP session');
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    // SSE endpoint
    let transport: SSEServerTransport | null = null;

    app.get('/mcp/sse', authMiddleware, async (req: express.Request, res: express.Response) => {
        logger.info('New MCP SSE connection');
        transport = new SSEServerTransport('/mcp/messages', res);
        await server.connect(transport);
    });

    // Messages endpoint
    app.post('/mcp/messages', authMiddleware, async (req: express.Request, res: express.Response) => {
        if (!transport) {
            res.status(400).json({ error: 'No active SSE connection' });
            return;
        }
        await transport.handlePostMessage(req, res);
    });

    return app;
}