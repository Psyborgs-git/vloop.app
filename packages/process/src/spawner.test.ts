import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessSpawner } from './spawner.js';

describe('ProcessSpawner', () => {
    let spawner: ProcessSpawner;

    beforeEach(() => {
        spawner = new ProcessSpawner();
    });

    it('spawns a typical process and captures exit code', async () => {
        const handle = spawner.spawn({
            id: 'test-1',
            command: 'node',
            args: ['-e', 'process.exit(42)'],
        });

        expect(handle.pid).toBeTypeOf('number');

        const exitEvent = await new Promise((resolve) => {
            spawner.on('exit', (event: any) => {
                if (event.id === handle.id) resolve(event);
            });
        });

        expect(exitEvent).toMatchObject({
            exitCode: 42,
            signal: null,
            oomKilled: false,
        });
    });

    it('injects environment variables', async () => {
        const handle = spawner.spawn({
            id: 'test-env',
            command: 'node',
            args: ['-e', 'if (process.env.TEST_VAR !== "123") process.exit(1); else process.exit(0);'],
            env: { TEST_VAR: '123' },
        });

        const exitEvent = await new Promise((resolve) => {
            spawner.on('exit', (event: any) => {
                if (event.id === handle.id) resolve(event);
            });
        });

        expect(exitEvent).toMatchObject({ exitCode: 0 });
    });

    it('handles termination (SIGTERM)', async () => {
        const handle = spawner.spawn({
            id: 'test-term',
            command: 'node',
            args: ['-e', 'setInterval(() => {}, 1000)'], // Hangs
        });

        const exitPromise = new Promise((resolve) => {
            spawner.on('exit', (event: any) => {
                if (event.id === handle.id) resolve(event);
            });
        });

        const ok = spawner.kill(handle, 'SIGTERM');
        expect(ok).toBe(true);

        const exitEvent = await exitPromise;
        expect((exitEvent as any).signal).toBe('SIGTERM');
    });
});
