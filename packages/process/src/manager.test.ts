import { describe, it, expect, vi } from 'vitest';
import { ProcessManager } from './manager.js';
import { createLogger } from '@orch/daemon';

describe('ProcessManager', () => {
    const logger = createLogger('error');

    it('starts and stops a simple process', async () => {
        const manager = new ProcessManager(logger);

        const managed = manager.start({
            id: 'test-proc-1',
            command: 'node',
            args: ['-e', 'setInterval(() => {}, 1000)'], // Hangs
            restartPolicy: 'never',
            maxRestarts: 0,
        });

        expect(managed.id).toBe('test-proc-1');
        expect(managed.status).toBe('running');
        expect(managed.pid).toBeTypeOf('number');

        await manager.stop('test-proc-1');

        const info = manager.get('test-proc-1');
        expect(info.status).toBe('stopped');
    });

    it('restarts a process on failure (on-failure policy)', async () => {
        const manager = new ProcessManager(logger);

        const managed = manager.start({
            id: 'test-fail-1',
            command: 'node',
            args: ['-e', 'process.exit(1)'], // Fails immediately
            restartPolicy: 'on-failure',
            maxRestarts: 2,
        });

        // Wait for it to restart and eventually fail completely
        await new Promise(r => setTimeout(r, 600));

        const info = manager.get('test-fail-1');
        expect(info.restartCount).toBeGreaterThan(0);

        // Eventually stops because of maxRestarts (if delay allows) or just marks failed
        expect(['failed', 'running', 'restarting']).toContain(info.status);
    });

    it('throws error when stopping non-existent process', async () => {
        const manager = new ProcessManager(logger);
        await expect(manager.stop('does-not-exist')).rejects.toThrowError(/not found/);
    });
});
