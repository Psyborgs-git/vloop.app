import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Router } from '../../packages/daemon/src/router.js';
import { createProcessHandler, ProcessManager, CronScheduler, ProcessLogManager } from '../../packages/process/src/index.js';
import { createLogger } from '../../packages/daemon/src/logging.js';

describe('Workload Integration (process & schedule topics)', () => {
    let router: Router;
    let processManager: ProcessManager;
    let scheduler: CronScheduler;

    const logger = createLogger('error');

    function makeRequest(topic: string, action: string, payload: unknown = {}) {
        return {
            id: `req-${Date.now()}`,
            topic,
            action,
            payload,
            meta: {
                timestamp: new Date().toISOString(),
                trace_id: `trace-${Date.now()}`,
            },
        };
    }

    beforeAll(() => {
        router = new Router(logger);

        processManager = new ProcessManager(logger);
        scheduler = new CronScheduler(logger);

        router.register('process', createProcessHandler(processManager, scheduler, new ProcessLogManager()));
        router.register('schedule', createProcessHandler(processManager, scheduler, new ProcessLogManager()));
    });

    afterAll(async () => {
        await processManager.shutdownAll();
        scheduler.stop();
    });

    it('spawns a process via router dispatch', async () => {
        const req = makeRequest('process', 'process.spawn', {
            id: 'integ-proc-1',
            command: 'echo',
            args: ['hello']
        });

        const res = await router.dispatch(req, logger);

        expect(res.type).toBe('result');
        const payload = res.payload as Record<string, unknown>;
        expect(payload.id).toBe('integ-proc-1');
        expect(payload.status).toBe('running');
    });

    it('creates a scheduled job via router dispatch', async () => {
        const req = makeRequest('schedule', 'schedule.create', {
            id: 'integ-cron-1',
            cron: '0 0 * * *',
            command: 'echo'
        });

        const res = await router.dispatch(req, logger);
        expect(res.type).toBe('result');

        const payload = res.payload as Record<string, unknown>;
        expect(payload.id).toBe('integ-cron-1');
        expect(payload.cron).toBe('0 0 * * *');
        expect(typeof payload.nextRun).toBe('string');
    });

    it('lists processes', async () => {
        const req = makeRequest('process', 'process.list');
        const res = await router.dispatch(req, logger);

        expect(res.type).toBe('result');
        const payload = res.payload as Record<string, unknown>;

        expect(Array.isArray(payload.processes)).toBe(true);
        const p = (payload.processes as any[]).find(x => x.id === 'integ-proc-1');
        expect(p).toBeDefined();
    });
});
