import { execSync } from "node:child_process";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

export async function installService(daemonEntrypoint: string): Promise<void> {
	const platform = process.platform;

	if (platform === "linux") {
		const serviceContent = `[Unit]
Description=Orchestrator Daemon
After=network.target

[Service]
ExecStart=${process.execPath} ${daemonEntrypoint}
Restart=always
User=${process.env.USER || "root"}
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
		const homeDir = process.env.HOME || process.env.USERPROFILE || "~";
		const svcPath = join(homeDir, ".config/systemd/user/orchestrator.service");
		execSync("mkdir -p ~/.config/systemd/user");
		writeFileSync(svcPath, serviceContent);
		execSync("systemctl --user daemon-reload");
		execSync("systemctl --user enable orchestrator.service");
		execSync("systemctl --user start orchestrator.service");
		console.log("Orchestrator installed and started as systemd user service.");
	} else if (platform === "darwin") {
		const homeDir = process.env.HOME || process.env.USERPROFILE || "~";
		const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.vloop.orchestrator</string>
    <key>ProgramArguments</key>
    <array>
        <string>${process.execPath}</string>
        <string>${daemonEntrypoint}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${homeDir}/Library/Logs/orchestrator.log</string>
    <key>StandardErrorPath</key>
    <string>${homeDir}/Library/Logs/orchestrator.error.log</string>
</dict>
</plist>`;
		const plistPath = join(
			homeDir,
			"Library/LaunchAgents/com.vloop.orchestrator.plist",
		);
		execSync(`mkdir -p "${homeDir}/Library/LaunchAgents"`);
		writeFileSync(plistPath, plistContent);
		try {
			execSync(`launchctl unload "${plistPath}" 2>/dev/null`);
		} catch {
			/* Ignore if not loaded */
		}
		execSync(`launchctl load "${plistPath}"`);
		console.log("Orchestrator installed and started as launchd agent (macOS).");
	} else if (platform === "win32") {
		// @ts-ignore - node-windows is only available on windows
		const { Service } = await import("node-windows");
		const svc = new Service({
			name: "OrchestratorDaemon",
			description: "VLoop Orchestrator Background Daemon",
			script: daemonEntrypoint,
			env: [{ name: "NODE_ENV", value: "production" }],
		});

		return new Promise((resolve) => {
			svc.on("install", () => {
				svc.start();
				console.log("Orchestrator installed and started as Windows Service.");
				resolve();
			});
			svc.install();
		});
	} else {
		throw new Error("Unsupported platform: " + platform);
	}
}
