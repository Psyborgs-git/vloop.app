/**
 * ADK StateAdapter — Bridges DAG-based persistence with ADK's InMemoryRunner.
 *
 * The ADK runner uses ephemeral in-memory sessions. The StateAdapter:
 * 1. Persists every ADK event as a StateNode in the execution DAG.
 * 2. Creates checkpoint snapshots for crash recovery.
 * 3. Persists chat messages in the message DAG.
 * 4. Updates the session's head_message_id pointer.
 *
 * This adapter is instantiated per-execution and passed to the orchestrator flow.
 */

import type {
	ExecutionId, SessionId, StateNodeId, MessageId,
	CreateStateNodeInput, CreateMessageInput,
	StateNodeKind,
} from './types.js';
import type { IStateNodeRepo } from './repos/interfaces.js';
import type { IMessageRepo } from './repos/interfaces.js';
import type { ISessionRepo } from './repos/interfaces.js';
import type { IExecutionRepo } from './repos/interfaces.js';

export interface StateAdapterOptions {
	executionId: ExecutionId;
	sessionId: SessionId;
	stateNodeRepo: IStateNodeRepo;
	messageRepo: IMessageRepo;
	sessionRepo: ISessionRepo;
	executionRepo: IExecutionRepo;
}

export class StateAdapter {
	private lastNodeId: StateNodeId | null = null;
	private readonly executionId: ExecutionId;
	private readonly sessionId: SessionId;
	private readonly stateNodeRepo: IStateNodeRepo;
	private readonly messageRepo: IMessageRepo;
	private readonly sessionRepo: ISessionRepo;
	private readonly executionRepo: IExecutionRepo;

	constructor(opts: StateAdapterOptions) {
		this.executionId = opts.executionId;
		this.sessionId = opts.sessionId;
		this.stateNodeRepo = opts.stateNodeRepo;
		this.messageRepo = opts.messageRepo;
		this.sessionRepo = opts.sessionRepo;
		this.executionRepo = opts.executionRepo;
	}

	/**
	 * Record an execution step as a StateNode in the DAG.
	 * Each node links to the previous via parentId, forming a linear chain
	 * within a single run (branches occur across different runs).
	 */
	recordStep(kind: StateNodeKind, payload: Record<string, unknown>, note?: string): StateNodeId {
		const input: CreateStateNodeInput = {
			executionId: this.executionId,
			parentId: this.lastNodeId,
			kind,
			status: 'running',
			payload,
			note,
		};
		const node = this.stateNodeRepo.create(input);
		this.lastNodeId = node.id;
		return node.id;
	}

	/** Mark a step as completed and optionally store a checkpoint. */
	completeStep(nodeId: StateNodeId, checkpoint?: Record<string, unknown>): void {
		this.stateNodeRepo.updateStatus(nodeId, 'completed');
		if (checkpoint) {
			this.stateNodeRepo.updateCheckpoint(nodeId, checkpoint);
		}
		// Update execution's last checkpoint pointer
		this.executionRepo.setLastCheckpoint(this.executionId, nodeId);
	}

	/** Mark a step as failed. */
	failStep(nodeId: StateNodeId): void {
		this.stateNodeRepo.updateStatus(nodeId, 'failed');
	}

	/** Mark a step as waiting for human input. */
	pauseStep(nodeId: StateNodeId): void {
		this.stateNodeRepo.updateStatus(nodeId, 'waiting_for_input');
	}

	/**
	 * Persist a chat message in the message DAG and update session head.
	 */
	persistMessage(input: CreateMessageInput): MessageId {
		const msg = this.messageRepo.create(input);
		this.sessionRepo.setHeadMessage(this.sessionId, msg.id);
		return msg.id;
	}

	/** Get the last state node ID (for DAG continuation). */
	getLastNodeId(): StateNodeId | null {
		return this.lastNodeId;
	}

	/** Set the starting point (for resume after crash). */
	setLastNodeId(nodeId: StateNodeId): void {
		this.lastNodeId = nodeId;
	}
}
