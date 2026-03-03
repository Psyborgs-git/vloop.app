/**
 * WorkerDispatcher — Manages a single-worker-per-execution model with queueing.
 *
 * - Spawns a worker_thread for each execution.
 * - Queues requests when the worker is busy.
 * - Handles crash detection and worker lifecycle tracking via repos.
 * - Forwards stream events to the caller via an emit callback.
 */

import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Logger } from '@orch/daemon';
import type { IExecutionRepo } from '../repos/interfaces.js';
import type { IWorkerRunRepo } from '../repos/interfaces.js';
import type { IAuditEventRepo } from '../repos/interfaces.js';
import type {
	ExecutionId, WorkerRunId, HitlWaitId,
} from '../types.js';
import type { MainToWorkerMsg, WorkerToMainMsg } from './protocol.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKER_SCRIPT = join(__dirname, 'worker-bootstrap.js');

export type StreamEmitter = (type: 'stream' | 'event', payload: unknown, seq?: number) => void;

interface PendingExecution {
	msg: MainToWorkerMsg;
	emit?: StreamEmitter;
	resolve: (output: string) => void;
	reject: (err: Error) => void;
}

export class WorkerDispatcher {
	private activeWorker: Worker | null = null;
	private activeExecutionId: ExecutionId | null = null;
	private activeRunId: WorkerRunId | null = null;
	private queue: PendingExecution[] = [];
	private currentPending: PendingExecution | null = null;

	constructor(
		private readonly executionRepo: IExecutionRepo,
		private readonly workerRunRepo: IWorkerRunRepo,
		private readonly auditEventRepo: IAuditEventRepo,
		private readonly logger: Logger,
		private readonly dbPath: string,
		private readonly dbPassphrase: string,
	) {}

	/**
	 * Submit an execution for worker processing.
	 * Returns a promise that resolves with the final output.
	 */
	runExecution(
		msg: MainToWorkerMsg,
		emit?: StreamEmitter,
	): Promise<string> {
		return new Promise((resolve, reject) => {
			const pending: PendingExecution = { msg, emit, resolve, reject };
			if (this.activeWorker) {
				this.queue.push(pending);
				return;
			}
			this.spawnWorker(pending);
		});
	}

	/** Send a HITL response to the active worker. */
	sendHitlResponse(hitlWaitId: HitlWaitId, approved: boolean, userResponse?: Record<string, unknown>): void {
		if (!this.activeWorker) {
			this.logger.warn('WorkerDispatcher: no active worker for HITL response');
			return;
		}
		this.activeWorker.postMessage({
			type: 'hitl-response',
			hitlWaitId,
			approved,
			userResponse,
		} satisfies MainToWorkerMsg);
	}

	/** Cancel the active execution. */
	cancel(): void {
		if (this.activeWorker) {
			this.activeWorker.postMessage({ type: 'cancel' } satisfies MainToWorkerMsg);
		}
	}

	/** Terminate worker and clear queue. */
	async shutdown(): Promise<void> {
		if (this.activeWorker) {
			await this.activeWorker.terminate();
			this.activeWorker = null;
		}
		this.queue = [];
	}

	// ── Private ──────────────────────────────────────────────────────────

	private spawnWorker(pending: PendingExecution): void {
		this.currentPending = pending;

		// Inject DB credentials into the start/resume message
		const msg = { ...pending.msg };
		if (msg.type === 'start' || msg.type === 'resume') {
			msg.dbPath = this.dbPath;
			msg.dbPassphrase = this.dbPassphrase;
		}

		const worker = new Worker(WORKER_SCRIPT, { workerData: { initialMsg: msg } });
		this.activeWorker = worker;

		if (msg.type === 'start' || msg.type === 'resume') {
			this.activeExecutionId = msg.executionId;
			// Create worker run record
			const run = this.workerRunRepo.create({ executionId: msg.executionId, threadId: worker.threadId });
			this.activeRunId = run.id;
			this.executionRepo.setWorkerRun(msg.executionId, run.id);
			this.workerRunRepo.updateStatus(run.id, 'running');
			this.auditEventRepo.create({ executionId: msg.executionId, kind: 'worker.start', payload: { runId: run.id } });
		}

		worker.on('message', (msg: WorkerToMainMsg) => this.handleWorkerMessage(msg));
		worker.on('error', (err: Error) => this.handleWorkerCrash(err));
		worker.on('exit', (code) => {
			if (code !== 0 && this.currentPending) {
				this.handleWorkerCrash(new Error(`Worker exited with code ${code}`));
			}
			this.activeWorker = null;
			this.drainQueue();
		});
	}

	private handleWorkerMessage(msg: WorkerToMainMsg): void {
		switch (msg.type) {
			case 'ready':
				this.logger.debug('Worker ready');
				break;

			case 'stream':
				if (this.currentPending?.emit) {
					this.currentPending.emit('stream', msg.event, msg.seq);
				}
				break;

			case 'hitl-request':
				if (this.currentPending?.emit) {
					this.currentPending.emit('event', {
						type: 'hitl-request',
						hitlWaitId: msg.hitlWaitId,
						toolContext: msg.toolContext,
						operatorInstructions: msg.operatorInstructions,
					});
				}
				break;

			case 'complete':
				if (this.activeRunId) {
					this.workerRunRepo.updateStatus(this.activeRunId, 'completed');
				}
				if (this.activeExecutionId) {
					this.executionRepo.updateStatus(this.activeExecutionId, 'completed', msg.output);
					this.auditEventRepo.create({ executionId: this.activeExecutionId, kind: 'execution.complete' });
				}
				this.currentPending?.resolve(msg.output);
				this.currentPending = null;
				this.activeExecutionId = null;
				this.activeRunId = null;
				break;

			case 'error':
				if (this.activeRunId) {
					this.workerRunRepo.updateStatus(this.activeRunId, 'failed', msg.error);
				}
				if (this.activeExecutionId) {
					this.executionRepo.updateStatus(this.activeExecutionId, 'failed');
					this.auditEventRepo.create({ executionId: this.activeExecutionId, kind: 'execution.fail', payload: { error: msg.error } });
				}
				this.currentPending?.reject(new Error(msg.error));
				this.currentPending = null;
				this.activeExecutionId = null;
				this.activeRunId = null;
				break;
		}
	}

	private handleWorkerCrash(err: Error): void {
		this.logger.error({ err }, 'WorkerDispatcher: worker crashed');
		if (this.activeRunId) {
			this.workerRunRepo.updateStatus(this.activeRunId, 'failed', err.message);
		}
		if (this.activeExecutionId) {
			this.executionRepo.updateStatus(this.activeExecutionId, 'failed');
			this.auditEventRepo.create({
				executionId: this.activeExecutionId,
				kind: 'worker.crash',
				payload: { error: err.message },
			});
		}
		this.currentPending?.reject(err);
		this.currentPending = null;
		this.activeExecutionId = null;
		this.activeRunId = null;
	}

	private drainQueue(): void {
		if (this.queue.length === 0) return;
		const next = this.queue.shift()!;
		this.spawnWorker(next);
	}
}
