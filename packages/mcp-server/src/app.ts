/**
 * Root App Config — Component lifecycle for @orch/mcp-server.
 *
 * Owns: MCP HTTP server lifecycle (StreamableHTTP + SSE transports).
 * Depends on: @orch/ai-agent (ToolRegistry), @orch/auth (SessionManager).
 *
 * The MCP server dynamically exposes all tools from the shared ToolRegistry
 * and authenticates requests via Bearer token through SessionManager and
 * the optional persistent TokenManager.
 */
import type { DependencyContainer } from 'tsyringe';
import type { AppComponent, AppComponentContext, AppToolRegistryContract } from '@orch/shared';
import { TOKENS, resolveConfig } from '@orch/shared';
import type { Logger } from '@orch/daemon';
import type { Server as HttpServer } from 'node:http';

import { createMcpHttpHandler } from './mcp-server.js';
import type { SessionManagerLike, TokenManagerLike } from './mcp-server.js';

function createMcpServerComponent(): AppComponent {
	let httpServer: HttpServer | undefined;

	return {
		name: '@orch/mcp-server',
		dependencies: ['@orch/ai-agent', '@orch/auth'],

		register(_container: DependencyContainer) {
			// No DI registrations needed — MCP server consumes shared tokens
		},

		init(_ctx: AppComponentContext) {
			// No initialization needed
		},

		async start({ container, healthRegistry }: AppComponentContext) {
			const config = resolveConfig(container);
			const logger = container.resolve<Logger>(TOKENS.Logger);

			try {
				const toolRegistry = container.resolve<AppToolRegistryContract>(TOKENS.ToolRegistry);
				const sessionManager = container.resolve<SessionManagerLike>(TOKENS.SessionManager);

				// TokenManager is optional — may not exist if persistent tokens aren't set up yet
				let tokenManager: TokenManagerLike | undefined;
				try {
					tokenManager = container.resolve<TokenManagerLike>(TOKENS.TokenManager);
				} catch {
					// Persistent tokens not available
				}

				const mcpApp = createMcpHttpHandler(toolRegistry, sessionManager, logger, tokenManager);

				httpServer = mcpApp.listen(
					config.network.mcp_port,
					config.network.bind_address,
					() => {
						logger.info(
							`MCP HTTP server listening on http://${config.network.bind_address}:${config.network.mcp_port}`,
						);
					},
				) as HttpServer;

				healthRegistry.registerSubsystem('mcp', () => ({
					name: 'mcp',
					status: 'healthy',
					message: `MCP server running on port ${config.network.mcp_port}`,
				}));
			} catch (err) {
				logger.warn({ err }, 'MCP HTTP handler disabled: dependencies unavailable');
			}
		},

		async stop({ container }: AppComponentContext) {
			const logger = container.resolve<Logger>(TOKENS.Logger);

			if (httpServer) {
				try {
					await new Promise<void>((resolve, reject) => {
						httpServer!.close((err) => (err ? reject(err) : resolve()));
					});
				} catch (err) {
					logger.error({ err }, 'Error closing MCP server');
				}
				httpServer = undefined;
			}
		},

		async cleanup(_ctx: AppComponentContext) {
			if (httpServer) {
				try {
					await new Promise<void>((res, rej) => httpServer!.close(err => err ? rej(err) : res()));
				} catch { /* swallow */ }
				httpServer = undefined;
			}
		},

		healthCheck() {
			return {
				name: 'mcp-server',
				status: httpServer ? 'healthy' : 'degraded',
				message: httpServer ? 'MCP server running' : 'MCP server offline',
			};
		},
	};
}

export default createMcpServerComponent();
