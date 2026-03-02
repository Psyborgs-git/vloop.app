import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { AgentOrchestrator } from './orchestrator.js';
import { ToolRegistry } from './tools.js';
import { AgentSandbox } from './sandbox.js';
import { Logger } from '@orch/daemon';
import { AIConfigStore } from './config/store.js';

describe('AgentOrchestrator', () => {
    let orchestrator: AgentOrchestrator;
    let mockTools: ToolRegistry;
    let mockSandbox: AgentSandbox;
    let mockLogger: vi.Mocked<Logger>;
    let store: AIConfigStore;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
        } as any;

        mockTools = new ToolRegistry(mockLogger);
        mockSandbox = new AgentSandbox(mockLogger);

        const db = new Database(':memory:');
        const orm = drizzle(db as any);
        store = new AIConfigStore(db as any, orm, mockLogger);
        store.migrate();

        orchestrator = new AgentOrchestrator(mockTools, mockSandbox, mockLogger, store);
    });

    it('initializes core services', async () => {
        expect(orchestrator).toBeDefined();
        expect(orchestrator.tools).toBeDefined();
        expect(orchestrator.sandbox).toBeDefined();
    });
});
