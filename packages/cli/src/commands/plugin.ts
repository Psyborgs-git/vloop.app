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
                // We need to add plugin methods to the client SDK first, or use raw dispatch
                // For now, raw dispatch is easiest since we haven't updated the client package yet.
                // But wait, getClient returns OrchestratorClient. We should probably update the client too.
                // Let's use raw `client.emit` or similar if exposed?
                // OrchestratorClient usually has typed namespaces.
                // Let's inspect OrchestratorClient.

                // Assuming we update client or use a workaround.
                // Actually, OrchestratorClient is in @orch/client.
                // I should update @orch/client to include the 'plugin' namespace.
                // But for this step, I can probably cast client to any to access the underlying transport or add the namespace.

                // Let's implement the client update in this step too as it's required for CLI.

                const response = await (client as any).send('plugin', 'list', {});
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
                const manifest = await (client as any).send('plugin', 'install', { url });

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
                    await (client as any).send('plugin', 'grant', {
                        id: manifest.id,
                        permissions: manifest.permissions
                    });
                    console.log(chalk.green(`\nPlugin ${manifest.name} installed successfully!`));
                } else {
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
                await (client as any).send('plugin', 'uninstall', { id });
                console.log(chalk.green(`Plugin ${id} uninstalled.`));
            } catch (err: any) {
                console.error(chalk.red(`Error: ${err.message}`));
            } finally {
                await client.disconnect();
            }
        });
}
