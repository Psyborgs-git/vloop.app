/**
 * Worker Bootstrap — Runs inside a worker_thread.
 *
 * Opens its own encrypted SQLite connection, instantiates repos + dstsx Predict,
 * and communicates with the dispatcher via the typed message protocol.
 */

import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { aiAgentV2Schema } from '../schema.js';
import type { AiAgentOrm } from '../orm-type.js';
import {
	Predict,
	ReAct,
	settings,
	type Tool,
} from '@jaex/dstsx';
import { createLM } from '../../config/lm-factory.js';
import { StateAdapter } from '../state-adapter.js';
import { StateNodeRepo } from '../repos/state-node-repo.js';
import { MessageRepo } from '../repos/message-repo.js';
import { SessionRepo } from '../repos/session-repo.js';
import { ExecutionRepo } from '../repos/execution-repo.js';
import { AgentRepo } from '../repos/agent-repo.js';
import { ProviderRepo } from '../repos/provider-repo.js';
import { ModelRepo } from '../repos/model-repo.js';
import { ToolRepo } from '../repos/tool-repo.js';
import { HitlWaitRepo } from '../repos/hitl-wait-repo.js';
import { ProviderManager } from '../provider-manager.js';
import type { WorkerStartMsg, WorkerToMainMsg, MainToWorkerMsg } from './protocol.js';
import type { CreateMessageInput, ExecutionId } from '../types.js';

const port = parentPort!;
const initial = (workerData as { initialMsg: MainToWorkerMsg }).initialMsg;

function send(msg: WorkerToMainMsg): void {
	port.postMessage(msg);
}

async function run(): Promise<void> {
	send({ type: 'ready' });

	if (initial.type !== 'start') {
		send({ type: 'error', executionId: '' as ExecutionId, error: 'Worker only supports start messages currently' });
		return;
	}

	const startMsg = initial as WorkerStartMsg;

	// Open worker-local DB connection
	const db = new Database(startMsg.dbPath);
	db.pragma(`key='${startMsg.dbPassphrase}'`);
	db.pragma('journal_mode=WAL');
	db.pragma('busy_timeout=5000');
	db.pragma('foreign_keys=ON');
	const orm = drizzle(db, { schema: aiAgentV2Schema }) as AiAgentOrm;

	// Instantiate repos
	const stateNodeRepo = new StateNodeRepo(orm);
	const messageRepo = new MessageRepo(orm);
	const sessionRepo = new SessionRepo(orm);
	const executionRepo = new ExecutionRepo(orm);
	const agentRepo = new AgentRepo(orm);
	const providerRepo = new ProviderRepo(orm);
	const modelRepo = new ModelRepo(orm);
	const toolRepo = new ToolRepo(orm);
	const hitlWaitRepo = new HitlWaitRepo(orm);
	const providerManager = new ProviderManager(providerRepo, modelRepo, undefined, console as any);

	// State adapter for this execution
	const stateAdapter = new StateAdapter({
		executionId: startMsg.executionId,
		sessionId: startMsg.sessionId,
		stateNodeRepo,
		messageRepo,
		sessionRepo,
		executionRepo,
	});

	let cancelled = false;

	// Listen for messages from dispatcher
	port.on('message', (msg: MainToWorkerMsg) => {
		if (msg.type === 'cancel') {
			cancelled = true;
		}
		if (msg.type === 'hitl-response') {
			const hitl = hitlWaitRepo.get(msg.hitlWaitId);
			if (hitl) {
				hitlWaitRepo.resolve(msg.hitlWaitId, msg.approved ? 'approved' : 'rejected', msg.userResponse);
			}
		}
	});

	try {
		// Load agent config
		const agentConfig = startMsg.agentId ? agentRepo.get(startMsg.agentId) : undefined;
		if (!agentConfig) {
			throw new Error(`Agent config not found: ${startMsg.agentId}`);
		}

		// Resolve model
		const resolved = await providerManager.resolve(agentConfig.modelId, agentConfig.params);
		const lm = createLM(resolved);

		// Build tools
		const dstsxTools: Tool[] = [];
		for (const toolId of agentConfig.toolIds) {
			const toolConfig = toolRepo.get(toolId);
			if (toolConfig) {
				dstsxTools.push({
					name: toolConfig.name,
					description: toolConfig.description,
					fn: async (args: string) => {
						let parsed: Record<string, unknown> = {};
						try { parsed = JSON.parse(args); } catch { /* tool args not JSON, use empty */ }
						return JSON.stringify(parsed);
					},
				});
			}
		}

		// Record workflow start
		stateAdapter.recordStep('workflow_start', { prompt: startMsg.prompt });

		// Persist user message
		const userMsgInput: CreateMessageInput = {
			sessionId: startMsg.sessionId,
			parentId: sessionRepo.get(startMsg.sessionId)?.headMessageId ?? null,
			role: 'user',
			content: startMsg.prompt,
		};
		stateAdapter.persistMessage(userMsgInput);

		// Run dstsx module
		const systemPrompt = agentConfig.systemPrompt || 'You are a helpful assistant.';
		let fullText = '';

		await settings.context(
			{ lm, lmConfig: { temperature: resolved.params.temperature, maxTokens: resolved.params.maxTokens } },
			async () => {
				if (dstsxTools.length > 0) {
					const react = new ReAct('question -> answer', dstsxTools);
					const result = await react.forward({
						question: `${systemPrompt}\n\n${startMsg.prompt}`,
					});
					fullText = String(result.get('answer') ?? '');
				} else {
					const predict = new Predict('question -> answer');
					predict.instructions = systemPrompt;

					let seq = 0;
					const chunks = predict.stream({ question: startMsg.prompt });
					for await (const chunk of chunks) {
						if (cancelled) break;
						fullText += chunk.delta;

						const nodeId = stateAdapter.recordStep('llm_call', { event: { author: 'assistant' } });
						stateAdapter.completeStep(nodeId, { seq });

						send({ type: 'stream', event: { text: chunk.delta, author: 'assistant' }, seq: seq++ });
					}
				}
			},
		);

		// Persist assistant message
		const session2 = sessionRepo.get(startMsg.sessionId);
		const assistantMsgInput: CreateMessageInput = {
			sessionId: startMsg.sessionId,
			parentId: session2?.headMessageId ?? null,
			role: 'assistant',
			content: fullText,
		};
		stateAdapter.persistMessage(assistantMsgInput);

		// Record workflow end
		const endNodeId = stateAdapter.recordStep('workflow_end', { output: fullText.substring(0, 500) });
		stateAdapter.completeStep(endNodeId);

		send({ type: 'complete', executionId: startMsg.executionId, output: fullText });
	} catch (err: any) {
		send({ type: 'error', executionId: startMsg.executionId, error: err.message ?? String(err) });
	} finally {
		db.close();
	}
}

run().catch(err => {
	send({ type: 'error', executionId: (initial as any).executionId ?? '', error: String(err) });
	process.exit(1);
});
