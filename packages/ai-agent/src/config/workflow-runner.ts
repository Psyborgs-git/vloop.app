/**
 * Workflow Runner — executes ADK-style workflows (sequential, parallel, loop).
 *
 * Workflows compose agents and sub-workflows into deterministic execution patterns.
 * Each step's output is piped to the next step's input (for sequential).
 */

import type { Logger, HandlerContext } from '@orch/daemon';
import type { AIConfigStore } from './store.js';
import type { AgentBuilder } from './agent-builder.js';
import type { WorkflowConfig, WorkflowId, WorkflowStep } from './types.js';
import { InMemoryRunner } from '@google/adk';

export interface WorkflowResult {
    workflowId: WorkflowId;
    status: 'completed' | 'failed';
    steps: StepResult[];
    finalOutput: string;
}

export interface StepResult {
    stepId: string;
    status: 'completed' | 'failed';
    output: string;
    durationMs: number;
}

export class WorkflowRunner {
    constructor(
        private readonly store: AIConfigStore,
        private readonly agentBuilder: AgentBuilder,
        private readonly logger: Logger,
    ) { }

    /**
     * Execute a workflow by ID with initial input.
     */
    async run(
        workflowId: WorkflowId,
        input: string,
        emit?: (type: 'stream' | 'event', payload: unknown, seq?: number) => void,
        vaultGet?: (ref: string) => Promise<string | undefined>,
        context?: HandlerContext,
    ): Promise<WorkflowResult> {
        const workflow = this.store.getWorkflow(workflowId);
        if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

        this.logger.info({ workflowId, type: workflow.type, steps: workflow.steps.length }, 'Starting workflow execution');

        let seq = 0;
        const emitEvent = (type: 'stream' | 'event', payload: unknown) => {
            if (emit) emit(type, payload, seq++);
        };

        emitEvent('event', { type: 'workflow.start', workflowId, name: workflow.name });

        try {
            const stepResults = await this.executeByType(workflow, input, emitEvent, vaultGet, context);
            const finalOutput = stepResults[stepResults.length - 1]?.output ?? '';

            emitEvent('event', { type: 'workflow.complete', workflowId });

            return {
                workflowId,
                status: 'completed',
                steps: stepResults,
                finalOutput,
            };
        } catch (err: any) {
            emitEvent('event', { type: 'workflow.error', workflowId, error: err.message });
            return {
                workflowId,
                status: 'failed',
                steps: [],
                finalOutput: `Workflow failed: ${err.message}`,
            };
        }
    }

    private async executeByType(
        workflow: WorkflowConfig,
        input: string,
        emit: (type: 'stream' | 'event', payload: unknown) => void,
        vaultGet?: (ref: string) => Promise<string | undefined>,
        context?: HandlerContext,
    ): Promise<StepResult[]> {
        switch (workflow.type) {
            case 'sequential':
                return this.runSequential(workflow.steps, input, emit, vaultGet, context);
            case 'parallel':
                return this.runParallel(workflow.steps, input, emit, vaultGet, context);
            case 'loop':
                return this.runLoop(workflow.steps, input, emit, vaultGet, context);
            default:
                throw new Error(`Unknown workflow type: ${workflow.type}`);
        }
    }

    private async runSequential(
        steps: WorkflowStep[],
        input: string,
        emit: (type: 'stream' | 'event', payload: unknown) => void,
        vaultGet?: (ref: string) => Promise<string | undefined>,
        context?: HandlerContext,
    ): Promise<StepResult[]> {
        const results: StepResult[] = [];
        let currentInput = input;

        for (const step of steps) {
            emit('event', { type: 'step.start', stepId: step.stepId });
            const result = await this.executeStep(step, currentInput, vaultGet, context);
            results.push(result);
            emit('event', { type: 'step.complete', stepId: step.stepId, status: result.status });

            if (result.status === 'failed') break;
            currentInput = result.output; // Pipe output to next step
        }

        return results;
    }

    private async runParallel(
        steps: WorkflowStep[],
        input: string,
        emit: (type: 'stream' | 'event', payload: unknown) => void,
        vaultGet?: (ref: string) => Promise<string | undefined>,
        context?: HandlerContext,
    ): Promise<StepResult[]> {
        emit('event', { type: 'parallel.start', stepCount: steps.length });

        const promises = steps.map(step => this.executeStep(step, input, vaultGet, context));
        const results = await Promise.allSettled(promises);

        return results.map((r, i) => {
            if (r.status === 'fulfilled') return r.value;
            return {
                stepId: steps[i]!.stepId,
                status: 'failed' as const,
                output: `Error: ${(r.reason as Error)?.message ?? 'Unknown error'}`,
                durationMs: 0,
            };
        });
    }

    private async runLoop(
        steps: WorkflowStep[],
        input: string,
        emit: (type: 'stream' | 'event', payload: unknown) => void,
        vaultGet?: (ref: string) => Promise<string | undefined>,
        context?: HandlerContext,
    ): Promise<StepResult[]> {
        const maxIterations = steps[0]?.maxIterations ?? 5;
        const results: StepResult[] = [];
        let currentInput = input;

        for (let i = 0; i < maxIterations; i++) {
            emit('event', { type: 'loop.iteration', iteration: i + 1, maxIterations });

            for (const step of steps) {
                const result = await this.executeStep(step, currentInput, vaultGet, context);
                results.push(result);
                if (result.status === 'failed') return results;
                currentInput = result.output;
            }

            // Simple completion check: if output contains a termination marker
            if (currentInput.includes('[DONE]') || currentInput.includes('[COMPLETE]')) {
                break;
            }
        }

        return results;
    }

    /**
     * Execute a single workflow step using ADK's InMemoryRunner.
     */
    private async executeStep(
        step: WorkflowStep,
        input: string,
        vaultGet?: (ref: string) => Promise<string | undefined>,
        context?: HandlerContext,
    ): Promise<StepResult> {
        const start = Date.now();

        try {
            if (step.agentId) {
                const built = await this.agentBuilder.build(step.agentId, vaultGet, context);
                const runner = new InMemoryRunner({
                    agent: built.agent,
                    appName: `workflow_${step.stepId}`,
                });

                const session = await runner.sessionService.createSession({
                    appName: `workflow_${step.stepId}`,
                    userId: 'workflow_user',
                });

                let output = '';
                const events = runner.runAsync({
                    userId: 'workflow_user',
                    sessionId: session.id,
                    newMessage: { role: 'user', parts: [{ text: input }] },
                });

                for await (const event of events) {
                    if (event.content?.parts) {
                        for (const part of event.content.parts) {
                            if ('text' in part && part.text) {
                                output += part.text;
                            }
                        }
                    }
                }

                return { stepId: step.stepId, status: 'completed', output, durationMs: Date.now() - start };
            }

            if (step.workflowId) {
                // Recursive workflow execution
                const result = await this.run(step.workflowId, input, undefined, vaultGet, context);
                return {
                    stepId: step.stepId,
                    status: result.status,
                    output: result.finalOutput,
                    durationMs: Date.now() - start,
                };
            }

            throw new Error(`Step ${step.stepId} has neither agentId nor workflowId`);
        } catch (err: any) {
            this.logger.error({ err, stepId: step.stepId }, 'Workflow step failed');
            return { stepId: step.stepId, status: 'failed', output: err.message, durationMs: Date.now() - start };
        }
    }
}
