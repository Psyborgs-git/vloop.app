import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { vi } from 'vitest';

vi.mock('../cli.js', () => ({
    getClient: vi.fn(),
}));

import { registerAgentCommands } from './agent.js';

describe('agent CLI commands', () => {
    it('registers AI lifecycle and execution subcommands', () => {
        const program = new Command();
        registerAgentCommands(program);

        const agentCommand = program.commands.find((c) => c.name() === 'agent');
        expect(agentCommand).toBeDefined();

        const subNames = agentCommand?.commands.map((c) => c.name()) || [];
        expect(subNames).toContain('providers');
        expect(subNames).toContain('models');
        expect(subNames).toContain('tools');
        expect(subNames).toContain('agents');
        expect(subNames).toContain('workflows');
        expect(subNames).toContain('chats');
        expect(subNames).toContain('chat-create');
        expect(subNames).toContain('chat-history');
        expect(subNames).toContain('send');
        expect(subNames).toContain('completion');
        expect(subNames).toContain('run-chat');
        expect(subNames).toContain('run-workflow');
        expect(subNames).toContain('memory-list');
        expect(subNames).toContain('memory-add');
        expect(subNames).toContain('memory-search');
        expect(subNames).toContain('sync-ollama');
    });
});
