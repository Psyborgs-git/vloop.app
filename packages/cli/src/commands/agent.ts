import { Command } from 'commander';
import chalk from 'chalk';
import { getClient } from '../cli.js';

type StreamLike = AsyncGenerator<any, any, undefined>;

function extractTextParts(chunk: unknown): string[] {
    const payload = (chunk as any)?.payload ?? chunk;
    const parts = payload?.content?.parts;
    if (!Array.isArray(parts)) return [];
    return parts
        .map((p) => (typeof p?.text === 'string' ? p.text : undefined))
        .filter((t): t is string => Boolean(t));
}

async function printStream(stream: StreamLike, jsonMode = false): Promise<void> {
    let printedText = false;
    for await (const chunk of stream) {
        if (jsonMode) {
            console.log(JSON.stringify(chunk, null, 2));
            continue;
        }

        const texts = extractTextParts(chunk);
        if (texts.length > 0) {
            process.stdout.write(texts.join(''));
            printedText = true;
            continue;
        }
    }

    if (printedText) {
        process.stdout.write('\n');
    }
}

function printResult(label: string, data: unknown) {
    console.log(chalk.green(label));
    console.log(JSON.stringify(data, null, 2));
}

export function registerAgentCommands(program: Command) {
    const agentCmd = program.command('agent').description('Interact with autonomous agents');

    agentCmd
        .command('run <workspaceId> <prompt>')
        .description('Legacy: trigger autonomous workflow action')
        .action(async (workspaceId, prompt) => {
            const client = await getClient();
            console.log(chalk.yellow(`Dispatching standard workflow: "${prompt}" to ${workspaceId}...`));
            try {
                const result = await client.agent.runWorkflow(workspaceId, prompt);
                printResult('Agent Workflow Finished:', result);
            } catch (err: any) {
                console.error(chalk.red(`Workflow Error: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    agentCmd
        .command('providers')
        .description('List configured AI providers')
        .action(async () => {
            const client = await getClient();
            try {
                printResult('Providers:', await client.agent.listProviders());
            } catch (err: any) {
                console.error(chalk.red(`Failed to list providers: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    agentCmd
        .command('models')
        .description('List configured AI models')
        .action(async () => {
            const client = await getClient();
            try {
                printResult('Models:', await client.agent.listModels());
            } catch (err: any) {
                console.error(chalk.red(`Failed to list models: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    agentCmd
        .command('tools')
        .description('List configured AI tools')
        .action(async () => {
            const client = await getClient();
            try {
                printResult('Tools:', await client.agent.listTools());
            } catch (err: any) {
                console.error(chalk.red(`Failed to list tools: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    agentCmd
        .command('agents')
        .description('List configured agents')
        .action(async () => {
            const client = await getClient();
            try {
                printResult('Agents:', await client.agent.listAgents());
            } catch (err: any) {
                console.error(chalk.red(`Failed to list agents: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    agentCmd
        .command('workflows')
        .description('List configured workflows')
        .action(async () => {
            const client = await getClient();
            try {
                printResult('Workflows:', await client.agent.listWorkflowConfigs());
            } catch (err: any) {
                console.error(chalk.red(`Failed to list workflows: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    agentCmd
        .command('chats')
        .description('List chat sessions')
        .action(async () => {
            const client = await getClient();
            try {
                printResult('Chat Sessions:', await client.agent.listChats());
            } catch (err: any) {
                console.error(chalk.red(`Failed to list chats: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    agentCmd
        .command('chat-create')
        .description('Create a chat session')
        .option('--agent <id>', 'Agent ID')
        .option('--workflow <id>', 'Workflow ID')
        .option('--model <id>', 'Model ID')
        .option('--provider <id>', 'Provider ID')
        .option('--mode <mode>', 'Mode: chat|agent|workflow')
        .option('--title <text>', 'Session title')
        .action(async (options) => {
            const client = await getClient();
            try {
                const created = await client.agent.createChat({
                    agentId: options.agent,
                    workflowId: options.workflow,
                    modelId: options.model,
                    providerId: options.provider,
                    mode: options.mode,
                    title: options.title,
                });
                printResult('Created chat session:', created);
            } catch (err: any) {
                console.error(chalk.red(`Failed to create chat: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    agentCmd
        .command('chat-history <sessionId>')
        .description('Fetch message history for a chat session')
        .action(async (sessionId) => {
            const client = await getClient();
            try {
                printResult('Chat history:', await client.agent.getChatHistory(sessionId));
            } catch (err: any) {
                console.error(chalk.red(`Failed to fetch chat history: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    agentCmd
        .command('send <sessionId> <content>')
        .description('Send a streaming chat message to a session')
        .option('--json', 'Print raw stream chunks as JSON', false)
        .action(async (sessionId, content, options) => {
            const client = await getClient();
            try {
                await printStream(client.agent.sendMessage(sessionId, content), options.json);
            } catch (err: any) {
                console.error(chalk.red(`Failed to send message: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    agentCmd
        .command('completion <prompt>')
        .description('Run a one-shot model completion')
        .option('--model <model>', 'Model string alias (legacy)')
        .option('--model-id <id>', 'Configured model ID')
        .option('--system <text>', 'System prompt')
        .option('--session <id>', 'Session ID')
        .option('--stream', 'Stream completion output', false)
        .option('--json', 'Print stream chunks as JSON', false)
        .action(async (prompt, options) => {
            const client = await getClient();
            try {
                const payload = {
                    prompt,
                    model: options.model,
                    modelId: options.modelId,
                    systemPrompt: options.system,
                    sessionId: options.session,
                };

                if (options.stream) {
                    await printStream(client.agent.chatCompletionStream(payload), options.json);
                } else {
                    printResult('Completion result:', await client.agent.chatCompletion(payload));
                }
            } catch (err: any) {
                console.error(chalk.red(`Completion failed: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    agentCmd
        .command('run-chat <agentId> <sessionId> <prompt>')
        .description('Run a streaming agent chat execution')
        .option('--json', 'Print raw stream chunks as JSON', false)
        .action(async (agentId, sessionId, prompt, options) => {
            const client = await getClient();
            try {
                await printStream(client.agent.runAgentChat(agentId, sessionId, prompt), options.json);
            } catch (err: any) {
                console.error(chalk.red(`Agent chat failed: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    agentCmd
        .command('run-workflow <workflowId> <input>')
        .description('Run a streaming workflow execution')
        .option('--json', 'Print raw stream chunks as JSON', false)
        .action(async (workflowId, input, options) => {
            const client = await getClient();
            try {
                await printStream(client.agent.runWorkflowExec(workflowId, input), options.json);
            } catch (err: any) {
                console.error(chalk.red(`Workflow execution failed: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    agentCmd
        .command('memory-list')
        .description('List memory entries')
        .option('--agent <id>', 'Filter by agent ID')
        .action(async (options) => {
            const client = await getClient();
            try {
                printResult('Memories:', await client.agent.listMemories(options.agent));
            } catch (err: any) {
                console.error(chalk.red(`Failed to list memories: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    agentCmd
        .command('memory-add <content>')
        .description('Create a memory entry')
        .option('--agent <id>', 'Agent ID')
        .option('--session <id>', 'Session ID')
        .action(async (content, options) => {
            const client = await getClient();
            try {
                const created = await client.agent.createMemory({
                    content,
                    agentId: options.agent,
                    sessionId: options.session,
                });
                printResult('Created memory:', created);
            } catch (err: any) {
                console.error(chalk.red(`Failed to create memory: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    agentCmd
        .command('memory-search <query>')
        .description('Search memory entries by text query')
        .action(async (query) => {
            const client = await getClient();
            try {
                printResult('Memory search:', await client.agent.searchMemories(query));
            } catch (err: any) {
                console.error(chalk.red(`Failed to search memory: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    agentCmd
        .command('sync-ollama')
        .description('Check and synchronize local/remote Ollama models into AI config')
        .option('--base-url <url>', 'Ollama base URL')
        .action(async (options) => {
            const client = await getClient();
            try {
                const availability = await client.agent.checkOllama(options.baseUrl);
                printResult('Ollama availability:', availability);
                if (!availability.available) return;

                const syncResult = await client.agent.syncOllama(options.baseUrl);
                printResult('Ollama sync result:', syncResult);
            } catch (err: any) {
                console.error(chalk.red(`Failed to sync Ollama: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });
}
