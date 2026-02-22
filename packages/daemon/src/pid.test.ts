import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

import {
    readPidFile,
    writePidFile,
    removePidFile,
    killExistingDaemon,
} from './pid.js';

let tmpDir: string;
let pidPath: string;

describe('pid utilities', () => {
    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'orch-pid-test-'));
        pidPath = join(tmpDir, 'orch.pid');
    });

    afterEach(() => {
        try {
            unlinkSync(pidPath);
        } catch {}
    });

    it('should write and read the current process pid', async () => {
        await writePidFile(pidPath);
        const pid = await readPidFile(pidPath);
        expect(pid).toBe(process.pid);
    });

    it('removePidFile should delete the file if it exists', async () => {
        await writePidFile(pidPath);
        expect(existsSync(pidPath)).toBe(true);
        await removePidFile(pidPath);
        expect(existsSync(pidPath)).toBe(false);
    });

    it('killExistingDaemon should terminate a live process and remove file', async () => {
        // spawn a short-lived node process that sleeps
        const sleeper = spawn(process.execPath, ['-e', 'setTimeout(()=>{},10000)']);
        await new Promise((r) => setTimeout(r, 100));

        const pid = sleeper.pid;
        expect(pid).toBeDefined();
        writeFileSync(pidPath, String(pid));

        await killExistingDaemon(pidPath);

        let alive = true;
        try {
            // pid is defined by assertion above
            process.kill(pid as number, 0);
        } catch {
            alive = false;
        }
        expect(alive).toBe(false);
        expect(existsSync(pidPath)).toBe(false);
    });

    it('killExistingDaemon should quietly handle stale pid and still remove file', async () => {
        writeFileSync(pidPath, '999999');
        await killExistingDaemon(pidPath);
        expect(existsSync(pidPath)).toBe(false);
    });
});