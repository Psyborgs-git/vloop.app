import { OrchestratorClient } from './packages/client/dist/client.js';
import { AgentClient } from './packages/client/dist/namespaces/agent.js';
import { AuthClient } from './packages/client/dist/namespaces/auth.js';

async function run() {
    const client = new OrchestratorClient({
        url: 'wss://localhost:9443',
        token: '0322',
        rejectUnauthorized: false
    });

    await client.connect();
    console.log('Connected');

    const authClient = new AuthClient(client);
    const loginRes = await authClient.login('admin', '0322');
    console.log('Logged in:', loginRes.session.identity);

    const agentClient = new AgentClient(client);

    // Create a workflow
    const workflow = await agentClient.createWorkflowConfig({
        name: 'Test Workflow ' + Date.now(),
        description: 'A test workflow',
        type: 'sequential',
        nodes: [
            { id: '1', type: 'input', position: { x: 0, y: 0 }, data: {} },
            { id: '2', type: 'output', position: { x: 100, y: 0 }, data: {} }
        ],
        edges: [
            { id: 'e1-2', source: '1', target: '2' }
        ]
    });
    console.log('Created workflow:', workflow);

    // List workflows
    const workflows = await agentClient.listWorkflowConfigs();
    console.log('Workflows:', workflows.workflows.length);

    // Test Ollama chat
    const providers = await agentClient.listProviders();
    let ollamaProvider = providers.providers.find(p => p.type === 'ollama');
    if (!ollamaProvider) {
        ollamaProvider = await agentClient.createProvider({
            name: 'Local Ollama',
            type: 'ollama',
            baseUrl: 'http://localhost:11434'
        });
    }

    const models = await agentClient.listModels();
    let llamaModel = models.models.find(m => m.modelId === 'gemma:2b');
    if (!llamaModel) {
        llamaModel = await agentClient.createModel({
            name: 'Gemma 2B',
            providerId: ollamaProvider.id,
            modelId: 'gemma:2b',
            params: {}
        });
    }

    const agent = await agentClient.createAgent({
        name: 'Test_Agent_' + Date.now(),
        modelId: llamaModel.id,
        systemPrompt: 'You are a helpful assistant.',
        toolIds: []
    });

    const chat = await agentClient.createChat({
        title: 'Test Chat',
        agentId: agent.id
    });

    console.log('Sending message to chat...');
    const stream = await agentClient.runAgentChat(agent.id, chat.id, 'Hello, who are you?');
    for await (const event of stream) {
        console.log('Event:', event.text);
    }

    console.log('Running workflow...');
    const execStream = agentClient.runWorkflowExec(workflow.id, 'test input');
    for await (const event of execStream) {
        console.log('Workflow Event:', event);
    }
    // Wait, AsyncGenerator doesn't return a value in for-await-of loop.
    // We can get the return value by calling next() manually or just ignoring it since the events contain the output.

    client.disconnect();
}

run().catch(console.error);
