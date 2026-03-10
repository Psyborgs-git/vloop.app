import { Command } from 'commander';
import chalk from 'chalk';
import { getClient } from '../cli.js';
import { confirm } from '@inquirer/prompts';

export function registerPluginCommands(program: Command) {
    const pluginCmd = program.command('plugin').description('Manage plugins');

    pluginCmd
        .command('list')
        .description('List installed plugins')
        .action(async () => {
            const client = await getClient();
            try {
                const response = await client.plugin.list();
                if (response.items.length === 0) {
                    console.log('No plugins installed.');
                } else {
                    console.table(response.items);
                }
            } catch (err: any) {
                console.error(chalk.red(`Error: ${err.message}`));
            } finally {
                await client.disconnect();
            }
        });

    pluginCmd
        .command('install <url>')
        .description('Install a plugin from a URL or file path')
        .action(async (url) => {
            const client = await getClient();
            try {
                console.log(chalk.blue(`Fetching plugin manifest from ${url}...`));
                const manifest = await client.plugin.install(url);

                console.log(chalk.green(`\nPlugin Found: ${manifest.name} (${manifest.version})`));
                console.log(`ID: ${manifest.id}`);
                console.log(`Description: ${manifest.description || 'N/A'}`);
                console.log(`Requested Permissions:`);
                if (manifest.permissions && manifest.permissions.length > 0) {
                    manifest.permissions.forEach((p: string) => console.log(` - ${p}`));
                } else {
                    console.log(` - None`);
                }

                const approved = await confirm({ message: 'Do you want to install this plugin and grant these permissions?' });

                if (approved) {
                    await client.plugin.grant(manifest.id, manifest.permissions);
                    console.log(chalk.green(`\nPlugin ${manifest.name} installed successfully!`));
                } else {
                    try {
                        await client.plugin.cancel(manifest.id);
                    } catch {
                        // best-effort: remove staged files
                    }
                    console.log(chalk.yellow('Installation cancelled.'));
                }

            } catch (err: any) {
                console.error(chalk.red(`Error: ${err.message}`));
            } finally {
                await client.disconnect();
            }
        });

    pluginCmd
        .command('uninstall <id>')
        .description('Uninstall a plugin')
        .action(async (id) => {
            const client = await getClient();
            try {
                await client.plugin.uninstall(id);
                console.log(chalk.green(`Plugin ${id} uninstalled.`));
            } catch (err: any) {
                console.error(chalk.red(`Error: ${err.message}`));
            } finally {
                await client.disconnect();
            }
        });
}
