import { Command } from 'commander';
import chalk from 'chalk';
import { getClient } from '../cli.js';

export function registerDbCommands(program: Command) {
    const db = program.command('db').description('Database management commands');

    db.command('provision')
        .description('Provision a new database for a workspace')
        .requiredOption('-w, --workspace <id>', 'Workspace ID')
        .option('-d, --description <desc>', 'Description of the database')
        .action(async (options) => {
            const client = await getClient();
            try {
                const result = await client.db.provision(options.workspace, options.description);
                console.log(chalk.green('Database provisioned successfully:'));
                console.log(JSON.stringify(result, null, 2));
            } catch (err: any) {
                console.error(chalk.red(`Failed to provision database: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    db.command('query')
        .description('Execute a SQL query against a database')
        .requiredOption('-w, --workspace <id>', 'Workspace ID')
        .requiredOption('-d, --db <id>', 'Database ID')
        .requiredOption('-q, --query <sql>', 'SQL query to execute')
        .option('-p, --params <json>', 'JSON array of parameters')
        .action(async (options) => {
            const client = await getClient();
            try {
                let params = [];
                if (options.params) {
                    params = JSON.parse(options.params);
                }
                const result = await client.db.query(options.workspace, options.db, options.query, params);
                console.log(chalk.green('Query executed successfully:'));
                console.log(JSON.stringify(result, null, 2));
            } catch (err: any) {
                console.error(chalk.red(`Failed to execute query: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });

    db.command('disconnect')
        .description('Disconnect a database')
        .requiredOption('-w, --workspace <id>', 'Workspace ID')
        .requiredOption('-d, --db <id>', 'Database ID')
        .action(async (options) => {
            const client = await getClient();
            try {
                await client.db.disconnect(options.workspace, options.db);
                console.log(chalk.green('Database disconnected successfully.'));
            } catch (err: any) {
                console.error(chalk.red(`Failed to disconnect database: ${err.message}`));
                process.exit(1);
            } finally {
                await client.disconnect();
            }
        });
}
