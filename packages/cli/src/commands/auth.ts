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

    // ── Persistent Token Commands ──────────────────────────────────────

    auth.command('token-create')
        .description('Create a persistent API token')
        .requiredOption('-n, --name <name>', 'Token name/label')
        .option('-t, --type <type>', 'Token type (user or agent)', 'user')
        .option('-r, --roles <roles>', 'Comma-separated roles')
        .option('-s, --scopes <scopes>', 'Comma-separated scopes', '*')
        .option('--ttl <seconds>', 'Time-to-live in seconds (0 = no expiry)')
        .action(async (options) => {
            const client = await getClient();
            try {
                const result = await client.auth.createToken({
                    name: options.name,
                    tokenType: options.type,
                    roles: options.roles ? options.roles.split(',').map((r: string) => r.trim()) : undefined,
                    scopes: options.scopes.split(',').map((s: string) => s.trim()),
                    ttlSecs: options.ttl ? Number(options.ttl) : undefined,
                });
                console.log(chalk.green('Token created successfully.'));
                console.log(chalk.yellow('Save this token — it will not be shown again:'));
                console.log(result.rawToken);
                console.log(chalk.dim(`\nToken ID: ${result.token.id}`));
                console.log(chalk.dim(`Name: ${result.token.name}`));
                console.log(chalk.dim(`Expires: ${result.token.expiresAt ?? 'never'}`));
            } catch (err: any) {
                console.error(chalk.red(`Failed to create token: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    auth.command('token-list')
        .description('List persistent tokens')
        .option('-i, --identity <identity>', 'Filter by identity')
        .action(async (options) => {
            const client = await getClient();
            try {
                const result = await client.auth.listTokens(options.identity);
                if (result.tokens.length === 0) {
                    console.log(chalk.dim('No tokens found.'));
                } else {
                    console.table(result.tokens.map((t: any) => ({
                        ID: t.id,
                        Name: t.name,
                        Type: t.tokenType,
                        Identity: t.identity,
                        Scopes: Array.isArray(t.scopes) ? t.scopes.join(', ') : t.scopes,
                        Expires: t.expiresAt ?? 'never',
                        Revoked: t.revoked ? 'yes' : 'no',
                    })));
                }
            } catch (err: any) {
                console.error(chalk.red(`Failed to list tokens: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    auth.command('token-revoke')
        .description('Revoke a persistent token')
        .requiredOption('-i, --id <id>', 'Token ID to revoke')
        .action(async (options) => {
            const client = await getClient();
            try {
                await client.auth.revokeToken(options.id);
                console.log(chalk.green('Token revoked successfully.'));
            } catch (err: any) {
                console.error(chalk.red(`Failed to revoke token: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });
}
