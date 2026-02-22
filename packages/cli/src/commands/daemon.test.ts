import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { registerDaemonCommands } from './daemon.js';

describe('daemon CLI commands', () => {
    it('should register kill command', () => {
        const program = new Command();
        registerDaemonCommands(program);
        const daemonCommand = program.commands.find((c) => c.name() === 'daemon');
        expect(daemonCommand).toBeDefined();
        const subNames = daemonCommand?.commands.map((c) => c.name()) || [];
        expect(subNames).toContain('kill');
    });
});