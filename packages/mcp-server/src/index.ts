/**
 * @orch/mcp-server — MCP HTTP transport service.
 *
 * Exposes tools from the shared ToolRegistry over MCP protocol
 * (StreamableHTTP + SSE) with Bearer token authentication.
 */

export { createMcpHttpHandler } from './mcp-server.js';
export type { SessionManagerLike, TokenManagerLike } from './mcp-server.js';
