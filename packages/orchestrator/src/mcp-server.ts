import express from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from '@orch/daemon';
import type { SessionManager } from '@orch/auth';
import type { ToolRegistry } from '@orch/ai-agent';

type AnyTransport = StreamableHTTPServerTransport | SSEServerTransport;
const transports = new Map<string, AnyTransport>();

/** Build a fresh McpServer wired to the shared tool registry. */
function buildMcpServer(toolRegistry: ToolRegistry, logger: Logger): McpServer {
    const server = new McpServer(
        { name: 'vloop-local-mcp', version: '1.0.0' },
        { capabilities: { tools: {}, logging: {} } }
    );

    // Use the low-level server to handle dynamic JSON-Schema tools from the registry
    server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: toolRegistry.list().map(t => ({
            name: t.name,
            description: t.description ?? '',
            inputSchema: t.parameters ?? { type: 'object', properties: {} },
        })),
    }));

    server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const tool = toolRegistry.get(request.params.name);
        if (!tool) {
            return {
                content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
                isError: true,
            };
        }
        try {
            const result = await tool.execute!(request.params.arguments ?? {});
            return {
                content: [{
                    type: 'text',
                    text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                }],
            };
        } catch (err: any) {
            logger.error({ err, tool: request.params.name }, 'MCP tool execution error');
            return {
                content: [{ type: 'text', text: `Error: ${err?.message ?? String(err)}` }],
                isError: true,
            };
        }
    });

    return server;
}

export function createMcpHttpHandler(
    toolRegistry: ToolRegistry,
    sessionManager: SessionManager,
    logger: Logger
): express.Express {
    const app = express();
    app.use(express.json());

    // ── Auth middleware ────────────────────────────────────────────────────────
    const authMiddleware: express.RequestHandler = (req, res, next) => {
        const authHeader = req.headers.authorization;
        const token = authHeader?.startsWith('Bearer ')
            ? authHeader.substring(7)
            : (req.query.token as string | undefined);

        if (!token) {
            res.status(401).json({ error: 'Unauthorized: Missing token' });
            return;
        }
        try {
            const session = sessionManager.validate(token);
            (req as any).mcpSession = session;
            next();
        } catch (err) {
            logger.error({ err }, 'MCP auth validation failed');
            res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
        }
    };

    // ── Streamable HTTP transport (protocol 2025-11-25) ───────────────────────
    app.all('/mcp', authMiddleware, async (req, res) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        try {
            // Re-use existing Streamable HTTP transport for an established session
            if (sessionId) {
                const existing = transports.get(sessionId);
                if (existing instanceof StreamableHTTPServerTransport) {
                    await existing.handleRequest(req, res, req.body);
                    return;
                }
                // Session exists but was opened on the SSE transport – reject
                res.status(400).json({
                    jsonrpc: '2.0',
                    error: { code: -32000, message: 'Session uses a different transport protocol' },
                    id: null,
                });
                return;
            }

            // Only POST + initialize can create a new session
            if (req.method !== 'POST' || !isInitializeRequest(req.body)) {
                res.status(400).json({
                    jsonrpc: '2.0',
                    error: { code: -32000, message: 'Bad Request: no active session' },
                    id: null,
                });
                return;
            }

            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (sid) => {
                    transports.set(sid, transport);
                    logger.info({ sessionId: sid }, 'MCP Streamable HTTP session opened');
                },
            });

            transport.onclose = () => {
                const sid = transport.sessionId;
                if (sid) {
                    transports.delete(sid);
                    logger.info({ sessionId: sid }, 'MCP Streamable HTTP session closed');
                }
            };

            const server = buildMcpServer(toolRegistry, logger);
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        } catch (err) {
            logger.error({ err }, 'MCP Streamable HTTP handler error');
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: { code: -32603, message: 'Internal server error' },
                    id: null,
                });
            }
        }
    });

    // ── Legacy HTTP+SSE transport (protocol 2024-11-05) ───────────────────────
    app.get('/sse', authMiddleware, async (_req, res) => {
        try {
            const transport = new SSEServerTransport('/messages', res);
            transports.set(transport.sessionId, transport);

            res.on('close', () => {
                transports.delete(transport.sessionId);
                logger.info({ sessionId: transport.sessionId }, 'MCP SSE session closed');
            });

            const server = buildMcpServer(toolRegistry, logger);
            await server.connect(transport);
            logger.info({ sessionId: transport.sessionId }, 'MCP SSE session opened');
        } catch (err) {
            logger.error({ err }, 'MCP SSE handler error');
        }
    });

    app.post('/messages', authMiddleware, async (req, res) => {
        const sessionId = req.query.sessionId as string | undefined;
        const transport = sessionId ? transports.get(sessionId) : undefined;

        if (!(transport instanceof SSEServerTransport)) {
            res.status(400).json({
                jsonrpc: '2.0',
                error: { code: -32000, message: 'No active SSE session for sessionId' },
                id: null,
            });
            return;
        }

        try {
            await transport.handlePostMessage(req, res, req.body);
        } catch (err) {
            logger.error({ err }, 'MCP SSE message handler error');
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: { code: -32603, message: 'Internal server error' },
                    id: null,
                });
            }
        }
    });

    return app;
}