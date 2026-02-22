import { Command } from 'commander';
import chalk from 'chalk';
import { installService, uninstallService } from '@orch/daemon';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

function getDaemonEntrypoint() {
    try {
        return require.resolve('@orch/orchestrator/dist/main.js');
    } catch {
        // Fallback for dev environments if needed
        return join(process.cwd(), 'packages/orchestrator/dist/main.js');
    }
}

export function registerDaemonCommands(program: Command) {
    const daemonCmd = program
        .command('daemon')
        .description('Manage the background Orchestrator Daemon OS Service');

    daemonCmd
        .command('install')
        .description('Install the orchestrator daemon as a background service (systemd/launchd/windows)')
        .action(async () => {
            const entrypoint = getDaemonEntrypoint();
            console.log(chalk.gray(`Installing OS native service targeting: ${entrypoint}`));
            try {
                await installService(entrypoint);
                console.log(chalk.green('✔ Daemon service installed successfully.'));
            } catch (err: any) {
                console.error(chalk.red(`Failed to install service: ${err.message}`));
            }
        });

    daemonCmd
        .command('uninstall')
        .description('Uninstall the background daemon service')
        .action(async () => {
            const entrypoint = getDaemonEntrypoint();
            console.log(chalk.gray(`Uninstalling OS native service...`));
            try {
                await uninstallService(entrypoint);
                console.log(chalk.green('✔ Daemon service uninstalled successfully.'));
            } catch (err: any) {
                console.error(chalk.red(`Failed to uninstall service: ${err.message}`));
            }
        });

    daemonCmd
        .command('start')
        .description('Start the installed background daemon')
        .action(() => {
            const platform = process.platform;
            try {
                if (platform === 'linux') {
                    execSync('systemctl --user start orchestrator.service');
                } else if (platform === 'darwin') {
                    execSync('launchctl start com.vloop.orchestrator');
                } else if (platform === 'win32') {
                    execSync('net start OrchestratorDaemon');
                }
                console.log(chalk.green('✔ Daemon started.'));
            } catch (err: any) {
                console.error(chalk.red(`Failed to start daemon: ${err.message}`));
            }
        });

    daemonCmd
        .command('stop')
        .description('Stop the installed background daemon')
        .action(() => {
            const platform = process.platform;
            try {
                if (platform === 'linux') {
                    execSync('systemctl --user stop orchestrator.service');
                } else if (platform === 'darwin') {
                    execSync('launchctl stop com.vloop.orchestrator');
                } else if (platform === 'win32') {
                    execSync('net stop OrchestratorDaemon');
                }
                console.log(chalk.green('✔ Daemon stopped.'));
            } catch (err: any) {
                console.error(chalk.red(`Failed to stop daemon: ${err.message}`));
            }
        });

    daemonCmd
        .command('kill')
        .description('Terminate any other running orchestrator instance and clean up pid file')
        .action(async () => {
            // the pid file path comes from the shared config; reuse the loader
            try {
                const { loadConfig } = await import('@orch/daemon');
                const config = loadConfig();
                const { killExistingDaemon } = await import('@orch/daemon');
                await killExistingDaemon(config.daemon.pid_file);
                console.log(chalk.green('✔ Existing orchestrator processes terminated (if any)')); 
            } catch (err: any) {
                console.error(chalk.red(`Failed to kill existing daemon: ${err.message}`));
            }
        });

    daemonCmd
        .command('logs')
        .description('Tail the logs of the background daemon')
        .option('-n, --lines <n>', 'Number of lines to show', '100')
        .action((options) => {
            const platform = process.platform;
            try {
                if (platform === 'linux') {
                    execSync(`journalctl --user -u orchestrator.service -n ${options.lines} -f`, { stdio: 'inherit' });
                } else if (platform === 'darwin') {
                    const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
                    execSync(`tail -n ${options.lines} -f "${homeDir}/Library/Logs/orchestrator.log"`, { stdio: 'inherit' });
                } else {
                    console.error(chalk.red('Log tailing is not implemented for this platform yet. Check event viewer on Windows.'));
                }
            } catch (err: any) {
                console.error(chalk.red(`Failed to tail logs: ${err.message}`));
            }
        });
}
