import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentOrchestrator } from './orchestrator.js';
import { ToolRegistry } from './tools.js';
import { AgentSandbox } from './sandbox.js';
import { AIConfigStore } from './config/store.js';
import Database from 'better-sqlite3-multiple-ciphers';
import { drizzle } from 'drizzle-orm/better-sqlite3';

describe('AgentOrchestrator - Multi-turn Tool Execution', () => {
    let orchestrator: AgentOrchestrator;
    let store: AIConfigStore;
    let tools: ToolRegistry;
    let sandbox: AgentSandbox;
    let logger: any;

    let agentId: any;
    let sessionId: any;

    beforeEach(() => {
        const db = new Database(':memory:');

        logger = {
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
        };

        const orm = drizzle(db as any);
        store = new AIConfigStore(db as any, orm, logger);
        store.migrate();

        tools = new ToolRegistry(logger);
        sandbox = new AgentSandbox(logger);

        // Register a test tool
        tools.register({
            name: 'get_weather',
            description: 'Get the current weather',
            parameters: {
                type: 'object',
                properties: {
                    location: { type: 'string' }
                },
                required: ['location']
            },
            execute: async (args) => {
                if (args.location === 'Toronto') return { temp: 22, condition: 'Sunny' };
                return { temp: 15, condition: 'Cloudy' };
            }
        });

        orchestrator = new AgentOrchestrator(tools, sandbox, logger, store);

        // Setup configs
        const provider = store.createProvider({
            name: 'Local Ollama',
            type: 'ollama',
            baseUrl: 'http://localhost:11434',
        });

        const model = store.createModel({
            providerId: provider.id,
            name: 'Llama 3.1',
            modelId: 'llama3.1',
        });

        const tool = store.createTool({
            name: 'get_weather',
            description: 'Get the current weather',
            handlerType: 'builtin',
            handlerConfig: { name: 'get_weather' },
            parametersSchema: {
                type: 'object',
                properties: {
                    location: { type: 'string' }
                },
                required: ['location']
            }
        });

        const agent = store.createAgent({
            name: 'Weather_Agent',
            modelId: model.id,
            systemPrompt: 'You are a weather assistant.',
            toolIds: [tool.id],
        });

        const session = store.createChatSession({
            agentId: agent.id,
            title: 'Weather Chat',
        });

        agentId = agent.id;
        sessionId = session.id;
    });

    it('should execute tools and return final result', async () => {
        let callCount = 0;

        // Mock fetch to simulate Ollama's multi-turn response
        globalThis.fetch = vi.fn().mockImplementation(async (url, options) => {
            callCount++;
            let body;
            try {
                body = JSON.parse(options.body);
            } catch (e) {
                console.error('Failed to parse body:', options.body);
                throw e;
            }

            if (callCount === 1) {
                // First turn: return a tool call
                return {
                    ok: true,
                    text: async () => JSON.stringify({
                        model: 'llama3.1',
                        message: {
                            role: 'assistant',
                            content: '',
                            tool_calls: [
                                {
                                    function: {
                                        name: 'get_weather',
                                        arguments: { location: 'Toronto' }
                                    }
                                }
                            ]
                        },
                        done_reason: 'tool_calls'
                    }),
                    body: {
                        getReader: () => {
                            let done = false;
                            return {
                                read: async () => {
                                    if (done) return { done: true };
                                    done = true;
                                    return {
                                        done: false,
                                        value: new TextEncoder().encode(JSON.stringify({
                                            model: 'llama3.1',
                                            message: {
                                                role: 'assistant',
                                                content: '',
                                                tool_calls: [
                                                    {
                                                        function: {
                                                            name: 'get_weather',
                                                            arguments: { location: 'Toronto' }
                                                        }
                                                    }
                                                ]
                                            },
                                            done_reason: 'tool_calls'
                                        }) + '\n')
                                    };
                                }
                            };
                        }
                    }
                };
            } else if (callCount === 2) {
                // Second turn: verify tool result was passed, return final text
                const lastMessage = body.messages[body.messages.length - 1];
                expect(lastMessage.role).toBe('tool');
                expect(lastMessage.content).toContain('Sunny');

                return {
                    ok: true,
                    text: async () => JSON.stringify({
                        model: 'llama3.1',
                        message: {
                            role: 'assistant',
                            content: 'The weather in Toronto is 22 degrees and Sunny.'
                        },
                        done_reason: 'stop'
                    }),
                    body: {
                        getReader: () => {
                            let done = false;
                            return {
                                read: async () => {
                                    if (done) return { done: true };
                                    done = true;
                                    return {
                                        done: false,
                                        value: new TextEncoder().encode(JSON.stringify({
                                            model: 'llama3.1',
                                            message: {
                                                role: 'assistant',
                                                content: 'The weather in Toronto is 22 degrees and Sunny.'
                                            },
                                            done_reason: 'stop'
                                        }) + '\n')
                                    };
                                }
                            };
                        }
                    }
                };
            }
        });

        const result = await orchestrator.runAgentChat({
            agentId,
            sessionId,
            prompt: 'What is the weather in Toronto?',
        });

        expect(callCount).toBe(2);
        expect(result.status).toBe('completed');
        expect(result.result).toBe('The weather in Toronto is 22 degrees and Sunny.');
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].name).toBe('get_weather');

        // Verify persistence
        const messages = store.listChatMessages(sessionId);
        expect(messages).toHaveLength(2); // user, assistant
        expect(messages[1].role).toBe('assistant');
        expect(messages[1].content).toBe('The weather in Toronto is 22 degrees and Sunny.');
        expect(messages[1].toolCalls).toBeDefined();
        expect(messages[1].toolResults).toBeDefined();
    });
});