import { Command } from 'commander';
import chalk from 'chalk';
import { getClient } from '../cli.js';

export function registerAgentCommands(program: Command) {
    const agentCmd = program.command('agent').description('Interact with autonomous agents');

    agentCmd
        .command('run <workspaceId> <prompt>')
        .description('Trigger an autonomous workflow')
        .action(async (workspaceId, prompt) => {
            const client = await getClient();
            console.log(chalk.yellow(`Dispatching standard workflow: "${prompt}" to ${workspaceId}...`));
            try {
                const result = await client.agent.runWorkflow(workspaceId, prompt);
                console.log(chalk.green(`Agent Workflow Finished. Result:`));
                console.dir(result, { depth: null, colors: true });
            } catch (err: any) {
                console.error(chalk.red(`Workflow Error: ${err.message}`));
            } finally {
                await client.disconnect();
            }
        });
}
