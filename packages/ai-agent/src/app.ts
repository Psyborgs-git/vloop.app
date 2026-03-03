/**
 * Root App Config — DI registration for @orch/ai-agent.
 *
 * This is the single package app entrypoint consumed by orchestrator.
 */
import type { DependencyContainer } from 'tsyringe';
import type { AppConfig } from '@orch/shared';
import { TOKENS, resolveConfig } from '@orch/shared';
import type { RootDatabaseOrm, DatabaseManager } from '@orch/shared/db';

import { AgentSandbox } from './sandbox.js';
import { ToolRegistry } from './tools.js';
import { AgentOrchestratorV2 } from './v2/orchestrator.js';
import type { OrchestratorRepos } from './v2/orchestrator.js';
import { V2_MIGRATION } from './v2/migrations.js';

import { ProviderRepo } from './v2/repos/provider-repo.js';
import { ModelRepo } from './v2/repos/model-repo.js';
import { ToolRepo } from './v2/repos/tool-repo.js';
import { McpServerRepo } from './v2/repos/mcp-server-repo.js';
import { AgentRepo } from './v2/repos/agent-repo.js';
import { WorkflowRepo } from './v2/repos/workflow-repo.js';
import { SessionRepo } from './v2/repos/session-repo.js';
import { MessageRepo } from './v2/repos/message-repo.js';
import { StateNodeRepo } from './v2/repos/state-node-repo.js';
import { ExecutionRepo } from './v2/repos/execution-repo.js';
import { WorkerRunRepo } from './v2/repos/worker-run-repo.js';
import { HitlWaitRepo } from './v2/repos/hitl-wait-repo.js';
import { AuditEventRepo } from './v2/repos/audit-event-repo.js';
import { MemoryRepo } from './v2/repos/memory-repo.js';
import { CanvasRepo } from './v2/repos/canvas-repo.js';

/** DI token for the v2 repos bundle */
export const V2_REPOS = Symbol('V2_REPOS');

interface VaultStoreLike {
	get(ref: string): { value?: string } | undefined;
}

interface DatabaseExecLike {
	exec(sql: string): unknown;
}

function buildRepos(orm: RootDatabaseOrm): OrchestratorRepos {
	return {
		provider: new ProviderRepo(orm),
		model: new ModelRepo(orm),
		tool: new ToolRepo(orm),
		mcpServer: new McpServerRepo(orm),
		agent: new AgentRepo(orm),
		workflow: new WorkflowRepo(orm),
		session: new SessionRepo(orm),
		message: new MessageRepo(orm),
		stateNode: new StateNodeRepo(orm),
		execution: new ExecutionRepo(orm),
		workerRun: new WorkerRunRepo(orm),
		hitlWait: new HitlWaitRepo(orm),
		auditEvent: new AuditEventRepo(orm),
		memory: new MemoryRepo(orm),
		canvas: new CanvasRepo(orm),
	};
}

const config: AppConfig = {
	name: '@orch/ai-agent',
	register(container: DependencyContainer) {
		container.register(AgentSandbox, {
			useFactory: (c) => new AgentSandbox(c.resolve(TOKENS.Logger)),
		});
		container.register(ToolRegistry, {
			useFactory: (c) => new ToolRegistry(c.resolve(TOKENS.Logger)),
		});

		container.register(V2_REPOS, {
			useFactory: (c) => buildRepos(c.resolve<RootDatabaseOrm>(TOKENS.DatabaseOrm)),
		});

		container.register(AgentOrchestratorV2, {
			useFactory: (c) => {
				const vaultGet = async (ref: string): Promise<string | undefined> => {
					try {
						const vaultStore = c.resolve<VaultStoreLike>(TOKENS.VaultStore);
						const secret = vaultStore.get(ref);
						return secret?.value;
					} catch {
						return undefined;
					}
				};

				const cfg = resolveConfig(c);
				const dbManager = c.resolve<DatabaseManager>(TOKENS.DatabaseManager);

				return new AgentOrchestratorV2(
					c.resolve(ToolRegistry),
					c.resolve(AgentSandbox),
					c.resolve(TOKENS.Logger),
					c.resolve<OrchestratorRepos>(V2_REPOS),
					vaultGet,
					cfg.ai_agent.db_path,
					dbManager.getPassphrase(),
				);
			},
		});
	},
	init(container: DependencyContainer) {
		const db = container.resolve<DatabaseExecLike>(TOKENS.Database);
		if (db?.exec) {
			db.exec(V2_MIGRATION);
		}
	},
};

export default config;
