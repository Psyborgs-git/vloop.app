import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from '@orch/daemon';

import { AIConfigStore } from './config/store.js';
import { AgentOrchestrator } from './orchestrator.js';
import { ToolRegistry } from './tools.js';
import { AgentSandbox } from './sandbox.js';

describe('AgentOrchestrator Ollama chat pipeline', () => {
    let tempDir: string;
    let db: InstanceType<typeof Database>;
    let store: AIConfigStore;
    let logger: Logger;
    let orchestrator: AgentOrchestrator;
    let fetchSpy: any;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'orch-ai-agent-'));
        db = new Database(join(tempDir, 'ai-agent.db'));

        logger = {
            info: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        } as any;

        store = new AIConfigStore(db as any, logger);
        store.migrate();

        orchestrator = new AgentOrchestrator(
            new ToolRegistry(logger),
            new AgentSandbox(logger),
            logger,
            store,
        );

        fetchSpy = vi.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
        fetchSpy.mockRestore();
        db.close();
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('uses provider/model config and persists session messages for Ollama completion', async () => {
        fetchSpy.mockResolvedValue({
            ok: true,
            json: async () => ({
                message: { content: 'Ollama pipeline verified' },
                done_reason: 'stop',
                prompt_eval_count: 7,
                eval_count: 11,
            }),
        } as Response);

        const provider = store.createProvider({
            name: 'Local Ollama',
            type: 'ollama',
            adapter: 'ollama',
            baseUrl: 'http://localhost:11434',
        });

        const model = store.createModel({
            name: 'Llama Local',
            providerId: provider.id,
            modelId: 'llama3.2:latest',
            runtime: 'chat',
            params: { temperature: 0.1 },
        });

        const session = store.createChatSession({
            title: 'Ollama Session',
            modelId: model.id,
            providerId: provider.id,
            mode: 'chat',
        });

        const result = await orchestrator.runChatCompletion({
            modelId: model.id,
            prompt: 'Say hello from local model',
            sessionId: session.id,
        });

        expect(result.status).toBe('completed');
        expect(result.result).toBe('Ollama pipeline verified');

        const messages = store.listChatMessages(session.id);
        expect(messages).toHaveLength(2);
        expect(messages[0]?.role).toBe('user');
        expect(messages[1]?.role).toBe('assistant');
        expect(messages[1]?.providerType).toBe('ollama');
        expect(messages[1]?.modelId).toBe('llama3.2:latest');
    });
});
