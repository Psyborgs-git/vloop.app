/**
 * Workflow Runner — executes React Flow-style graph workflows.
 *
 * Workflows compose agents and tools into deterministic execution patterns.
 * Execution traverses the graph from 'input' nodes to 'output' nodes.
 */

import type { Logger, HandlerContext } from '@orch/daemon';
import type { AIConfigStore } from './store.js';
import type { AgentBuilder } from './agent-builder.js';
import type { WorkflowConfig, WorkflowId, WorkflowNode } from './types.js';
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

        this.logger.info({ workflowId, type: workflow.type, nodes: workflow.nodes.length }, 'Starting workflow execution');

        let seq = 0;
        const emitEvent = (type: 'stream' | 'event', payload: unknown) => {
            if (emit) emit(type, payload, seq++);
        };

        emitEvent('event', { type: 'workflow.start', workflowId, name: workflow.name });

        const executionId = this.store.createWorkflowExecution({ workflowId, input });

        try {
            const { stepResults, finalOutput } = await this.executeGraph(executionId, workflow, input, emitEvent, vaultGet, context);

            emitEvent('event', { type: 'workflow.complete', workflowId });
            this.store.updateWorkflowExecution(executionId, { status: 'completed', finalOutput });

            return {
                workflowId,
                status: 'completed',
                steps: stepResults,
                finalOutput,
            };
        } catch (err: any) {
            emitEvent('event', { type: 'workflow.error', workflowId, error: err.message });
            this.store.updateWorkflowExecution(executionId, { status: 'failed', finalOutput: err.message });
            return {
                workflowId,
                status: 'failed',
                steps: [],
                finalOutput: `Workflow failed: ${err.message}`,
            };
        }
    }

    private async executeGraph(
        executionId: string,
        workflow: WorkflowConfig,
        initialInput: string,
        emit: (type: 'stream' | 'event', payload: unknown) => void,
        vaultGet?: (ref: string) => Promise<string | undefined>,
        context?: HandlerContext,
    ): Promise<{ stepResults: StepResult[], finalOutput: string }> {
        const results: StepResult[] = [];
        const nodeOutputs = new Map<string, string>();
        let finalOutput = '';

        const nodeTypeOf = (node: WorkflowNode): string => {
            const directType = typeof node.type === 'string' ? node.type : '';
            if (directType && directType !== 'workflowNode') return directType;
            const kind = typeof node.data?.kind === 'string' ? node.data.kind : '';
            return kind || directType || 'agent';
        };

        const getNodeById = (nodeId: string): WorkflowNode | undefined =>
            workflow.nodes.find(n => n.id === nodeId);

        const isReachable = (fromId: string, predicate: (node: WorkflowNode) => boolean): boolean => {
            const seen = new Set<string>();
            const q: string[] = [fromId];
            while (q.length > 0) {
                const current = q.shift()!;
                if (seen.has(current)) continue;
                seen.add(current);
                const node = getNodeById(current);
                if (!node) continue;
                if (predicate(node)) return true;
                const outgoing = workflow.edges.filter(e => e.source === current);
                for (const edge of outgoing) q.push(edge.target);
            }
            return false;
        };
        
        // Find input node
        const inputNode = workflow.nodes.find(n => nodeTypeOf(n) === 'input');
        if (!inputNode) throw new Error('Workflow has no input node');

        const hasReachableOutput = isReachable(inputNode.id, (n) => nodeTypeOf(n) === 'output');
        if (!hasReachableOutput) {
            throw new Error('Workflow has no executable path from input to output');
        }
        
        nodeOutputs.set(inputNode.id, initialInput);
        
        // Simple BFS traversal
        const queue = [inputNode.id];
        const visited = new Set<string>();
        
        while (queue.length > 0) {
            const nodeId = queue.shift()!;
            if (visited.has(nodeId)) continue;
            visited.add(nodeId);
            
            const node = getNodeById(nodeId);
            if (!node) continue;
            const nodeType = nodeTypeOf(node);
            
            // Get inputs from incoming edges
            const incomingEdges = workflow.edges.filter(e => e.target === nodeId);
            let nodeInput = '';
            
            if (nodeType === 'input') {
                nodeInput = initialInput;
            } else {
                // Combine outputs from previous nodes
                const inputs = incomingEdges.map(e => nodeOutputs.get(e.source)).filter(Boolean);
                nodeInput = inputs.join('\n\n');
            }
            
            if (nodeType !== 'input') {
                const start = Date.now();
                const stepExecId = this.store.createWorkflowStepExecution({ executionId, nodeId: node.id });
                emit('event', { type: 'workflow.step.start', stepId: node.id, nodeType });
                
                try {
                    let output = '';
                    if (nodeType === 'agent') {
                        output = await this.executeAgentNode(node, nodeInput, vaultGet, context);
                    } else if (nodeType === 'output') {
                        output = nodeInput;
                        finalOutput = output;
                    } else {
                        output = `Executed ${nodeType} node`;
                    }
                    
                    nodeOutputs.set(node.id, output);
                    
                    const result: StepResult = {
                        stepId: node.id,
                        status: 'completed',
                        output,
                        durationMs: Date.now() - start,
                    };
                    results.push(result);
                    
                    this.store.updateWorkflowStepExecution(stepExecId, { status: 'completed', output });
                    emit('event', { type: 'workflow.step.complete', stepId: node.id, output });
                } catch (err: any) {
                    const result: StepResult = {
                        stepId: node.id,
                        status: 'failed',
                        output: err.message,
                        durationMs: Date.now() - start,
                    };
                    results.push(result);
                    
                    this.store.updateWorkflowStepExecution(stepExecId, { status: 'failed', error: err.message });
                    throw err;
                }
            }
            
            // Add next nodes to queue
            const outgoingEdges = workflow.edges.filter(e => e.source === nodeId);
            for (const edge of outgoingEdges) {
                // Only add if all its dependencies are met (for parallel joins)
                const targetIncoming = workflow.edges.filter(e => e.target === edge.target);
                const allDepsMet = targetIncoming.every(e => nodeOutputs.has(e.source) || e.source === nodeId);
                
                if (allDepsMet) {
                    queue.push(edge.target);
                }
            }
        }

        if (!finalOutput) {
            throw new Error('Workflow finished without producing output. Ensure an output node is connected to the execution path.');
        }
        
        return { stepResults: results, finalOutput };
    }

    private async executeAgentNode(
        node: WorkflowNode,
        input: string,
        vaultGet?: (ref: string) => Promise<string | undefined>,
        context?: HandlerContext,
    ): Promise<string> {
        const agentId = node.data?.agentId;
        if (!agentId) throw new Error(`Agent node ${node.id} has no agentId configured`);
        
        const built = await this.agentBuilder.build(agentId, vaultGet, context);
        
        const runner = new InMemoryRunner({
            agent: built.agent,
            appName: `workflow_node_${node.id}`,
        });

        const session = await runner.sessionService.createSession({
            appName: `workflow_node_${node.id}`,
            userId: 'workflow_user',
        });

        let fullText = '';
        const events = runner.runAsync({
            userId: 'workflow_user',
            sessionId: session.id,
            newMessage: { role: 'user', parts: [{ text: input }] },
        });

        for await (const event of events) {
            if (event.content?.parts) {
                for (const part of event.content.parts) {
                    if ('text' in part && part.text) {
                        fullText += part.text;
                    }
                }
            }
        }
        
        return fullText;
    }
}
