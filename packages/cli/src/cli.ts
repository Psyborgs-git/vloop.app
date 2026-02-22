#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { OrchestratorClient } from '@orch/client';

import { registerProcessCommands } from './commands/process.js';
import { registerContainerCommands } from './commands/container.js';
import { registerVaultCommands } from './commands/vault.js';
import { registerAgentCommands } from './commands/agent.js';
import { registerDaemonCommands } from './commands/daemon.js';

const program = new Command();

program
    .name('orch')
    .description('Orchestrator CLI')
    .version('0.1.0')
    .option('-h, --host <url>', 'Orchestrator WebSocket URL', process.env.ORCH_HOST || 'ws://localhost:9000')
    .option('-t, --token <jwt>', 'Authentication token', process.env.ORCH_TOKEN);

/**
 * Utility to instantiate the client centrally for commands.
 */
export async function getClient(): Promise<OrchestratorClient> {
    const opts = program.opts();
    const client = new OrchestratorClient({
        url: opts.host,
        token: opts.token,
    });

    try {
        await client.connect();
        return client;
    } catch (err: any) {
        console.error(chalk.red(`Failed to connect to orchestrator at ${opts.host}: ${err.message}`));
        process.exit(1);
    }
}

// Register subcommands
registerProcessCommands(program);
registerContainerCommands(program);
registerVaultCommands(program);
registerAgentCommands(program);
registerDaemonCommands(program);

program.parse(process.argv);
