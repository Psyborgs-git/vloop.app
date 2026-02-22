import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { getClient } from '../cli.js';

export function registerProcessCommands(program: Command) {
    const processCmd = program.command('process').description('Manage host-native LRP workloads');

    processCmd
        .command('ls')
        .description('List all active native processes')
        .action(async () => {
            const client = await getClient();
            try {
                const result = await client.process.list();

                const table = new Table({
                    head: [chalk.cyan('ID'), chalk.cyan('PID'), chalk.cyan('Command'), chalk.cyan('Status')],
                });

                for (const p of result.processes || []) {
                    table.push([p.id, p.pid || '-', p.command, p.status]);
                }

                console.log(table.toString());
            } catch (err: any) {
                console.error(chalk.red(`Error: ${err.message}`));
            } finally {
                await client.disconnect();
            }
        });

    processCmd
        .command('spawn <id> <cmd> [args...]')
        .description('Spawn a new process')
        .action(async (id, cmd, args) => {
            const client = await getClient();
            try {
                const res = await client.process.spawn({ id, command: cmd, args });
                console.log(chalk.green(`Successfully spawned process ${id} (PID: ${res.pid})`));
            } catch (err: any) {
                console.error(chalk.red(`Error: ${err.message}`));
            } finally {
                await client.disconnect();
            }
        });

    processCmd
        .command('kill <id>')
        .description('Terminate a process')
        .action(async (id) => {
            const client = await getClient();
            try {
                await client.process.kill(id);
                console.log(chalk.green(`Sent kill signal to process ${id}`));
            } catch (err: any) {
                console.error(chalk.red(`Error: ${err.message}`));
            } finally {
                await client.disconnect();
            }
        });
}
