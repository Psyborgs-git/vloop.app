import { Command } from 'commander';
import chalk from 'chalk';
import { getClient } from '../cli.js';

export function registerVaultCommands(program: Command) {
    const vaultCmd = program.command('vault').description('Interact with the AES-256 Secrets Vault');

    vaultCmd
        .command('get <path>')
        .description('Read a secret from the vault')
        .action(async (path) => {
            const client = await getClient();
            try {
                const result = await client.vault.get(path);
                console.log(chalk.green(`Value: `) + result?.secret?.value);
            } catch (err: any) {
                console.error(chalk.red(`Error: ${err.message}`));
            } finally {
                await client.disconnect();
            }
        });

    vaultCmd
        .command('put <path> <value>')
        .description('Write a secret into the vault')
        .action(async (path, value) => {
            const client = await getClient();
            try {
                await client.vault.put(path, value);
                console.log(chalk.green(`Successfully wrote secret to ${path}`));
            } catch (err: any) {
                console.error(chalk.red(`Error: ${err.message}`));
            } finally {
                await client.disconnect();
            }
        });
}
