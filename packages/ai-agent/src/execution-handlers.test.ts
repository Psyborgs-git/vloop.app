import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerExecutionHandlers } from './execution-handlers.js';
import { AgentOrchestrator } from './orchestrator.js';
import { AIConfigStore } from './config/store.js';
import { ErrorCode, OrchestratorError } from '@orch/shared';
import type { HandlerContext } from '@orch/daemon';

describe('registerExecutionHandlers', () => {
    let mockHandlers: Map<string, any>;
    let mockOrchestrator: AgentOrchestrator;
    let mockConfigStore: AIConfigStore;
    let mockContext: HandlerContext;

    beforeEach(() => {
        mockHandlers = new Map();

        mockOrchestrator = {
            runAgentChat: vi.fn(),
            runChatCompletion: vi.fn(),
            runWorkflow: vi.fn(),
            rerunChatFromMessage: vi.fn(),
            forkChatFromMessage: vi.fn(),
            compactChatContext: vi.fn(),
            ollamaSync: {
                sync: vi.fn(),
                isAvailable: vi.fn(),
            },
        } as unknown as AgentOrchestrator;

        mockConfigStore = {
            getChatSession: vi.fn(),
        } as unknown as AIConfigStore;

        mockContext = {
            emit: vi.fn(),
        } as unknown as HandlerContext;
    });

    it('should register all execution handlers', () => {
        registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
        expect(mockHandlers.has('workflow')).toBe(true);
        expect(mockHandlers.has('chat.send')).toBe(true);
        expect(mockHandlers.has('chat.completions')).toBe(true);
        expect(mockHandlers.has('run.chat')).toBe(true);
        expect(mockHandlers.has('chat.rerun')).toBe(true);
        expect(mockHandlers.has('chat.fork')).toBe(true);
        expect(mockHandlers.has('chat.compact')).toBe(true);
        expect(mockHandlers.has('run.workflow')).toBe(true);
        expect(mockHandlers.has('sync.ollama')).toBe(true);
        expect(mockHandlers.has('sync.ollama.check')).toBe(true);
    });

    describe('workflow handler', () => {
        it('should throw validation error if workspaceId or prompt are missing', () => {
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('workflow');
            expect(() => handler({}, mockContext)).toThrowError(OrchestratorError);
            try {
                handler({}, mockContext);
            } catch (e: any) {
                expect(e.code).toBe(ErrorCode.VALIDATION_ERROR);
                expect(e.message).toContain('workspaceId and prompt are required');
            }
        });

        it('should throw legacy support error even with valid params', () => {
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('workflow');
            try {
                handler({ workspaceId: 'ws1', prompt: 'test' }, mockContext);
            } catch (e: any) {
                expect(e.code).toBe(ErrorCode.VALIDATION_ERROR);
                expect(e.message).toContain('Legacy workflow execution is no longer supported');
            }
        });
    });

    describe('chat.send handler', () => {
        it('should throw service unavailable if configStore is missing', () => {
            registerExecutionHandlers(mockHandlers, mockOrchestrator, undefined);
            const handler = mockHandlers.get('chat.send');
            try {
                handler({ sessionId: 's1', content: 'hello' }, mockContext);
            } catch (e: any) {
                expect(e.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
            }
        });

        it('should throw validation error if sessionId or content are missing', () => {
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('chat.send');
            try {
                handler({}, mockContext);
            } catch (e: any) {
                expect(e.code).toBe(ErrorCode.VALIDATION_ERROR);
            }
        });

        it('should throw not found error if chat session does not exist', () => {
            vi.mocked(mockConfigStore.getChatSession).mockReturnValue(undefined);
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('chat.send');
            try {
                handler({ sessionId: 's1', content: 'hello' }, mockContext);
            } catch (e: any) {
                expect(e.code).toBe(ErrorCode.NOT_FOUND);
            }
        });

        it('should throw validation error if chat session has no agent assigned', () => {
            vi.mocked(mockConfigStore.getChatSession).mockReturnValue({ agentId: undefined } as any);
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('chat.send');
            try {
                handler({ sessionId: 's1', content: 'hello' }, mockContext);
            } catch (e: any) {
                expect(e.code).toBe(ErrorCode.VALIDATION_ERROR);
            }
        });

        it('should call orchestrator.runAgentChat on success', () => {
            vi.mocked(mockConfigStore.getChatSession).mockReturnValue({ agentId: 'agent1' } as any);
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('chat.send');

            handler({ sessionId: 's1', content: 'hello' }, mockContext);

            expect(mockOrchestrator.runAgentChat).toHaveBeenCalledWith(
                { agentId: 'agent1', sessionId: 's1', prompt: 'hello' },
                mockContext.emit,
                mockContext
            );
        });
    });

    describe('chat.completions handler', () => {
        it('should throw validation error if prompt is missing', () => {
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('chat.completions');
            try {
                handler({ model: 'gpt-4' }, mockContext);
            } catch (e: any) {
                expect(e.code).toBe(ErrorCode.VALIDATION_ERROR);
            }
        });

        it('should throw validation error if neither model nor modelId are provided', () => {
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('chat.completions');
            try {
                handler({ prompt: 'hello' }, mockContext);
            } catch (e: any) {
                expect(e.code).toBe(ErrorCode.VALIDATION_ERROR);
            }
        });

        it('should call orchestrator.runChatCompletion on success', () => {
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('chat.completions');
            const payload = { prompt: 'hello', model: 'gpt-4' };

            handler(payload, mockContext);

            expect(mockOrchestrator.runChatCompletion).toHaveBeenCalledWith(payload, mockContext.emit);
        });
    });

    describe('run.chat handler', () => {
        it('should throw validation error if required params are missing', () => {
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('run.chat');
            try {
                handler({}, mockContext);
            } catch (e: any) {
                expect(e.code).toBe(ErrorCode.VALIDATION_ERROR);
            }
        });

        it('should call orchestrator.runAgentChat on success', () => {
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('run.chat');
            const payload = { agentId: 'a1', sessionId: 's1', prompt: 'hello' };

            handler(payload, mockContext);

            expect(mockOrchestrator.runAgentChat).toHaveBeenCalledWith(
                payload,
                mockContext.emit,
                mockContext
            );
        });
    });

    describe('run.workflow handler', () => {
        it('should throw validation error if required params are missing', () => {
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('run.workflow');
            try {
                handler({}, mockContext);
            } catch (e: any) {
                expect(e.code).toBe(ErrorCode.VALIDATION_ERROR);
            }
        });

        it('should call orchestrator.runWorkflow on success', () => {
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('run.workflow');
            const payload = { workflowId: 'wf1', input: 'input data' };

            handler(payload, mockContext);

            expect(mockOrchestrator.runWorkflow).toHaveBeenCalledWith(
                'wf1',
                'input data',
                mockContext.emit,
                mockContext
            );
        });
    });

    describe('chat.rerun handler', () => {
        it('should throw service unavailable if configStore is missing', () => {
            registerExecutionHandlers(mockHandlers, mockOrchestrator, undefined);
            const handler = mockHandlers.get('chat.rerun');
            try {
                handler({ sessionId: 's1', messageId: 'm1' }, mockContext);
            } catch (e: any) {
                expect(e.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
            }
        });

        it('should throw validation error if required params are missing', () => {
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('chat.rerun');
            try {
                handler({}, mockContext);
            } catch (e: any) {
                expect(e.code).toBe(ErrorCode.VALIDATION_ERROR);
            }
        });

        it('should throw not found error if chat session does not exist', () => {
            vi.mocked(mockConfigStore.getChatSession).mockReturnValue(undefined);
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('chat.rerun');
            try {
                handler({ sessionId: 's1', messageId: 'm1' }, mockContext);
            } catch (e: any) {
                expect(e.code).toBe(ErrorCode.NOT_FOUND);
            }
        });

        it('should call orchestrator.rerunChatFromMessage on success', () => {
            vi.mocked(mockConfigStore.getChatSession).mockReturnValue({ id: 's1' } as any);
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('chat.rerun');

            handler({ sessionId: 's1', messageId: 'm1', toolIds: ['t1'] }, mockContext);

            expect(mockOrchestrator.rerunChatFromMessage).toHaveBeenCalledWith(
                { sessionId: 's1', messageId: 'm1', toolIds: ['t1'] },
                mockContext.emit,
                mockContext
            );
        });
    });

    describe('chat.fork handler', () => {
        it('should throw service unavailable if configStore is missing', () => {
            registerExecutionHandlers(mockHandlers, mockOrchestrator, undefined);
            const handler = mockHandlers.get('chat.fork');
            try {
                handler({ sessionId: 's1', messageId: 'm1' }, mockContext);
            } catch (e: any) {
                expect(e.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
            }
        });

        it('should throw validation error if required params are missing', () => {
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('chat.fork');
            try {
                handler({}, mockContext);
            } catch (e: any) {
                expect(e.code).toBe(ErrorCode.VALIDATION_ERROR);
            }
        });

        it('should throw not found error if chat session does not exist', () => {
            vi.mocked(mockConfigStore.getChatSession).mockReturnValue(undefined);
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('chat.fork');
            try {
                handler({ sessionId: 's1', messageId: 'm1' }, mockContext);
            } catch (e: any) {
                expect(e.code).toBe(ErrorCode.NOT_FOUND);
            }
        });

        it('should call orchestrator.forkChatFromMessage on success', () => {
            vi.mocked(mockConfigStore.getChatSession).mockReturnValue({ id: 's1' } as any);
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('chat.fork');

            handler({ sessionId: 's1', messageId: 'm1', title: 'Forked' }, mockContext);

            expect(mockOrchestrator.forkChatFromMessage).toHaveBeenCalledWith(
                { sessionId: 's1', messageId: 'm1', title: 'Forked' }
            );
        });
    });

    describe('chat.compact handler', () => {
        it('should throw service unavailable if configStore is missing', () => {
            registerExecutionHandlers(mockHandlers, mockOrchestrator, undefined);
            const handler = mockHandlers.get('chat.compact');
            try {
                handler({ sessionId: 's1' }, mockContext);
            } catch (e: any) {
                expect(e.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
            }
        });

        it('should throw validation error if sessionId is missing', () => {
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('chat.compact');
            try {
                handler({}, mockContext);
            } catch (e: any) {
                expect(e.code).toBe(ErrorCode.VALIDATION_ERROR);
            }
        });

        it('should throw not found error if chat session does not exist', () => {
            vi.mocked(mockConfigStore.getChatSession).mockReturnValue(undefined);
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('chat.compact');
            try {
                handler({ sessionId: 's1' }, mockContext);
            } catch (e: any) {
                expect(e.code).toBe(ErrorCode.NOT_FOUND);
            }
        });

        it('should call orchestrator.compactChatContext on success', () => {
            vi.mocked(mockConfigStore.getChatSession).mockReturnValue({ id: 's1' } as any);
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('chat.compact');

            handler({ sessionId: 's1', maxChars: 12345, keepLastMessages: 8 }, mockContext);

            expect(mockOrchestrator.compactChatContext).toHaveBeenCalledWith({
                sessionId: 's1',
                maxChars: 12345,
                keepLastMessages: 8,
            });
        });
    });

    describe('sync.ollama handlers', () => {
        it('should call orchestrator.ollamaSync.sync', async () => {
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('sync.ollama');
            const payload = { baseUrl: 'http://localhost:11434' };

            await handler(payload, mockContext);

            expect(mockOrchestrator.ollamaSync.sync).toHaveBeenCalledWith('http://localhost:11434');
        });

        it('should call orchestrator.ollamaSync.isAvailable', async () => {
            vi.mocked(mockOrchestrator.ollamaSync.isAvailable).mockResolvedValue(true);
            registerExecutionHandlers(mockHandlers, mockOrchestrator, mockConfigStore);
            const handler = mockHandlers.get('sync.ollama.check');
            const payload = { baseUrl: 'http://localhost:11434' };

            const result = await handler(payload, mockContext);

            expect(mockOrchestrator.ollamaSync.isAvailable).toHaveBeenCalledWith('http://localhost:11434');
            expect(result).toEqual({ available: true });
        });
    });
});
