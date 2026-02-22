import { describe, it, expect } from 'vitest';
import { CronScheduler, ScheduledJob } from './scheduler.js';
import { createLogger } from '@orch/daemon';

describe('CronScheduler', () => {
    const logger = createLogger('error');

    it('creates a job with a valid cron expression', () => {
        const scheduler = new CronScheduler(logger);
        const job = scheduler.create({
            id: 'test-cron-1',
            cron: '*/5 * * * *',
            command: 'echo',
            args: ['hello'],
        });

        expect(job.id).toBe('test-cron-1');
        expect(job.cron).toBe('*/5 * * * *');
        expect(job.nextRun).toBeTypeOf('string');
        expect(new Date(job.nextRun as string).getTime()).toBeGreaterThan(Date.now());
    });

    it('creates a one-shot job', () => {
        const scheduler = new CronScheduler(logger);
        const future = new Date(Date.now() + 10000).toISOString();
        const job = scheduler.create({
            id: 'test-shot-1',
            runAt: future,
            command: 'echo',
        });

        expect(job.cron).toBeNull();
        expect(job.nextRun).toBe(future);
    });

    it('rejects invalid cron expressions', () => {
        const scheduler = new CronScheduler(logger);
        expect(() => {
            scheduler.create({
                id: 'bad-cron',
                cron: 'invalid-cron-string',
                command: 'echo',
            });
        }).toThrow(/Invalid cron expression/);
    });

    it('enforces either cron or runAt', () => {
        const scheduler = new CronScheduler(logger);
        expect(() => {
            scheduler.create({
                id: 'no-schedule',
                command: 'echo',
            });
        }).toThrow(/must have either/);
    });

    it('executes a one-shot job and cleans up (timeout support)', async () => {
        const scheduler = new CronScheduler(logger);
        const future = new Date(Date.now() + 100).toISOString(); // Run in 100ms

        const job = scheduler.create({
            id: 'exec-test',
            runAt: future,
            command: 'sleep',
            args: ['1'],
            timeoutMs: 50,
        });

        // Setup executor mock
        let executed = false;
        scheduler.setExecutor(async (j) => {
            executed = true;
            // simulate long task
            await new Promise(r => setTimeout(r, 200));
            return { exitCode: 0 };
        });

        scheduler.start();

        // Wait to see if it times out
        await new Promise(r => setTimeout(r, 300));
        scheduler.stop();

        expect(executed).toBe(true);
        const updatedJob = scheduler.get('exec-test');
        expect(updatedJob.lastResult).toBe('timeout');
        expect(updatedJob.enabled).toBe(false); // one-shot disables after run
    });
});
