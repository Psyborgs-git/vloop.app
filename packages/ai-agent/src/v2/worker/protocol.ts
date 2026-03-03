/**
 * Worker-thread typed message protocol.
 *
 * All messages between the dispatcher (main thread) and worker follow this protocol.
 */

import type { ExecutionId, SessionId, AgentConfigId, WorkflowId, StateNodeId, HitlWaitId } from '../types.js';

// ─── Main → Worker Messages ─────────────────────────────────────────────────

export interface WorkerStartMsg {
	type: 'start';
	executionId: ExecutionId;
	sessionId: SessionId;
	agentId?: AgentConfigId;
	workflowId?: WorkflowId;
	prompt: string;
	/** DB path for the worker to open its own connection. */
	dbPath: string;
	/** DB passphrase for encryption. */
	dbPassphrase: string;
}

export interface WorkerResumeMsg {
	type: 'resume';
	executionId: ExecutionId;
	fromCheckpointId: StateNodeId;
	dbPath: string;
	dbPassphrase: string;
}

export interface WorkerHitlResponseMsg {
	type: 'hitl-response';
	hitlWaitId: HitlWaitId;
	approved: boolean;
	userResponse?: Record<string, unknown>;
}

export interface WorkerCancelMsg {
	type: 'cancel';
}

export type MainToWorkerMsg = WorkerStartMsg | WorkerResumeMsg | WorkerHitlResponseMsg | WorkerCancelMsg;

// ─── Worker → Main Messages ─────────────────────────────────────────────────

export interface WorkerStreamMsg {
	type: 'stream';
	event: any;
	seq: number;
}

export interface WorkerHitlRequestMsg {
	type: 'hitl-request';
	hitlWaitId: HitlWaitId;
	toolContext: Record<string, unknown>;
	operatorInstructions: string;
}

export interface WorkerCompleteMsg {
	type: 'complete';
	executionId: ExecutionId;
	output: string;
}

export interface WorkerErrorMsg {
	type: 'error';
	executionId: ExecutionId;
	error: string;
}

export interface WorkerReadyMsg {
	type: 'ready';
}

export type WorkerToMainMsg = WorkerStreamMsg | WorkerHitlRequestMsg | WorkerCompleteMsg | WorkerErrorMsg | WorkerReadyMsg;
