import { Command } from 'commander';
import chalk from 'chalk';
import { getClient } from '../cli.js';

export function registerAuthCommands(program: Command) {
    const auth = program.command('auth').description('Authentication and user management commands');

    auth.command('login')
        .description('Login to obtain a JWT token')
        .requiredOption('-e, --email <email>', 'User email')
        .requiredOption('-p, --password <password>', 'User password')
        .action(async (options) => {
            const client = await getClient();
            try {
                const result = await client.auth.login(options.email, options.password);
                console.log(chalk.green('Login successful. Token:'));
                console.log(result.token);
            } catch (err: any) {
                console.error(chalk.red(`Login failed: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    auth.command('user-create')
        .description('Create a new user')
        .requiredOption('-e, --email <email>', 'User email')
        .requiredOption('-p, --password <password>', 'User password')
        .option('-r, --roles <roles>', 'Comma-separated list of roles (e.g., admin,viewer)', 'viewer')
        .action(async (options) => {
            const client = await getClient();
            try {
                const roles = options.roles.split(',').map((r: string) => r.trim());
                const result = await client.auth.createUser(options.email, options.password, roles);
                console.log(chalk.green('User created successfully:'));
                console.log(JSON.stringify(result, null, 2));
            } catch (err: any) {
                console.error(chalk.red(`Failed to create user: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    auth.command('user-update-roles')
        .description('Update roles for a user')
        .requiredOption('-e, --email <email>', 'User email')
        .requiredOption('-r, --roles <roles>', 'Comma-separated list of roles')
        .action(async (options) => {
            const client = await getClient();
            try {
                const roles = options.roles.split(',').map((r: string) => r.trim());
                await client.auth.updateUserRoles(options.email, roles);
                console.log(chalk.green('User roles updated successfully.'));
            } catch (err: any) {
                console.error(chalk.red(`Failed to update user roles: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    auth.command('user-update-password')
        .description('Update password for a user')
        .requiredOption('-e, --email <email>', 'User email')
        .requiredOption('-p, --password <password>', 'New password')
        .action(async (options) => {
            const client = await getClient();
            try {
                await client.auth.updatePassword(options.email, options.password);
                console.log(chalk.green('User password updated successfully.'));
            } catch (err: any) {
                console.error(chalk.red(`Failed to update user password: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    auth.command('user-list')
        .description('List all users')
        .action(async () => {
            const client = await getClient();
            try {
                const users = await client.auth.listUsers();
                console.table(users);
            } catch (err: any) {
                console.error(chalk.red(`Failed to list users: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    auth.command('provider-add')
        .description('Add a new JWT provider')
        .requiredOption('-n, --name <name>', 'Provider name')
        .requiredOption('-i, --issuer <issuer>', 'Issuer URL')
        .requiredOption('-j, --jwks <url>', 'JWKS URL')
        .action(async (options) => {
            const client = await getClient();
            try {
                const result = await client.auth.addProvider(options.issuer, options.jwks, options.name);
                console.log(chalk.green('Provider added successfully:'));
                console.log(JSON.stringify(result, null, 2));
            } catch (err: any) {
                console.error(chalk.red(`Failed to add provider: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    auth.command('provider-remove')
        .description('Remove a JWT provider')
        .requiredOption('-i, --id <id>', 'Provider ID')
        .action(async (options) => {
            const client = await getClient();
            try {
                await client.auth.removeProvider(options.id);
                console.log(chalk.green('Provider removed successfully.'));
            } catch (err: any) {
                console.error(chalk.red(`Failed to remove provider: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    auth.command('provider-list')
        .description('List all JWT providers')
        .action(async () => {
            const client = await getClient();
            try {
                const providers = await client.auth.listProviders();
                console.table(providers);
            } catch (err: any) {
                console.error(chalk.red(`Failed to list providers: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });
}
