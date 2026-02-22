import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';

export async function uninstallService(daemonEntrypoint: string): Promise<void> {
    const platform = process.platform;

    if (platform === 'linux') {
        const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
        const svcPath = join(homeDir, '.config/systemd/user/orchestrator.service');
        try {
            execSync('systemctl --user stop orchestrator.service 2>/dev/null');
            execSync('systemctl --user disable orchestrator.service 2>/dev/null');
        } catch { /* Ignore if not running */ }

        if (existsSync(svcPath)) {
            unlinkSync(svcPath);
        }
        execSync('systemctl --user daemon-reload');
        console.log('Orchestrator systemd service removed.');
    } else if (platform === 'darwin') {
        const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
        const plistPath = join(homeDir, 'Library/LaunchAgents/com.vloop.orchestrator.plist');
        try {
            execSync(`launchctl unload "${plistPath}" 2>/dev/null`);
        } catch { /* Ignore if not loaded */ }

        if (existsSync(plistPath)) {
            unlinkSync(plistPath);
        }
        console.log('Orchestrator launchd agent removed.');
    } else if (platform === 'win32') {
        // @ts-ignore
        const { Service } = await import('node-windows');
        const svc = new Service({
            name: 'OrchestratorDaemon',
            script: daemonEntrypoint
        });

        return new Promise((resolve) => {
            svc.on('uninstall', () => {
                console.log('Orchestrator Windows Service removed.');
                resolve();
            });
            svc.uninstall();
        });
    } else {
        throw new Error('Unsupported platform: ' + platform);
    }
}
