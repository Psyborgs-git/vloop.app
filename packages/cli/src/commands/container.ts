import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { getClient } from '../cli.js';

export function registerContainerCommands(program: Command) {
    const containerCmd = program.command('container').alias('ps').description('Manage docker-compatible containers');

    containerCmd
        .command('ls')
        .description('List active containers managed by Orchestrator')
        .action(async () => {
            const client = await getClient();
            try {
                const result = await client.container.list();

                const table = new Table({
                    head: [chalk.cyan('Container ID'), chalk.cyan('Name'), chalk.cyan('Image'), chalk.cyan('State')],
                });

                for (const c of result.containers || []) {
                    table.push([c.Id.substring(0, 12), c.Names?.[0] || '-', c.Image, c.State]);
                }

                console.log(table.toString());
            } catch (err: any) {
                console.error(chalk.red(`Error: ${err.message}`));
            } finally {
                await client.disconnect();
            }
        });

    containerCmd
        .command('pull <image>')
        .description('Pull a container image')
        .action(async (image) => {
            const client = await getClient();
            console.log(chalk.yellow(`Pulling image ${image}...`));
            try {
                // Technically this triggers a stream in the daemon,
                // but the high-level API resolves when the pull finishes or starts.
                await client.container.pull(image);
                console.log(chalk.green(`Successfully initiated pull for ${image}`));
            } catch (err: any) {
                console.error(chalk.red(`Error: ${err.message}`));
            } finally {
                await client.disconnect();
            }
        });
}
