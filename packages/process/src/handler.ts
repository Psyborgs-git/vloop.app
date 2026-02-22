/**
 * WebSocket topic handler for `process.*` and `schedule.*` actions.
 */

import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { ProcessManager, ProcessDefinition } from './manager.js';
import type { CronScheduler, CreateJobOptions } from './scheduler.js';
import type { ProcessLogManager } from './logs.js';

// ─── Handler Factory ────────────────────────────────────────────────────────

export function createProcessHandler(
    processManager: ProcessManager,
    scheduler: CronScheduler,
    logManager: ProcessLogManager,
) {
    return async (action: string, payload: unknown): Promise<unknown> => {
        const data = (payload ?? {}) as Record<string, unknown>;

        switch (action) {
            // ── Process actions ─────────────────────────────────────────
            case 'process.spawn': {
                const definition: ProcessDefinition = {
                    id: requireString(data, 'id'),
                    command: requireString(data, 'command'),
                    args: (data['args'] as string[]) ?? [],
                    cwd: data['cwd'] as string | undefined,
                    env: data['env'] as Record<string, string> | undefined,
                    restartPolicy: (data['restartPolicy'] as ProcessDefinition['restartPolicy']) ?? 'never',
                    maxRestarts: (data['maxRestarts'] as number) ?? 5,
                    shutdownTimeoutMs: (data['shutdownTimeoutMs'] as number) ?? 10000,
                };

                const managed = processManager.start(definition);
                return {
                    id: managed.id,
                    pid: managed.pid,
                    status: managed.status,
                    startedAt: managed.startedAt,
                };
            }

            case 'process.stop': {
                const id = requireString(data, 'id');
                await processManager.stop(id);
                return { ok: true, id };
            }

            case 'process.restart': {
                const id = requireString(data, 'id');
                const managed = await processManager.restart(id);
                return {
                    id: managed.id,
                    pid: managed.pid,
                    status: managed.status,
                    restartCount: managed.restartCount,
                };
            }

            case 'process.list': {
                const processes = processManager.list();
                return {
                    processes: processes.map((p) => ({
                        id: p.id,
                        command: p.command,
                        pid: p.pid,
                        status: p.status,
                        healthy: p.healthy,
                        restartCount: p.restartCount,
                        startedAt: p.startedAt,
                    })),
                };
            }

            case 'process.inspect': {
                const id = requireString(data, 'id');
                return processManager.get(id);
            }

            case 'process.logs': {
                const id = requireString(data, 'id');
                const tail = data['tail'] as number | undefined;
                return { logs: logManager.getLogs(id, tail) };
            }

            // ── Scheduler actions ───────────────────────────────────────
            case 'schedule.create': {
                const options: CreateJobOptions = {
                    id: requireString(data, 'id'),
                    cron: data['cron'] as string | undefined,
                    runAt: data['runAt'] as string | undefined,
                    command: requireString(data, 'command'),
                    args: (data['args'] as string[]) ?? [],
                    cwd: data['cwd'] as string | undefined,
                    env: data['env'] as Record<string, string> | undefined,
                    timeoutMs: data['timeoutMs'] as number | undefined,
                };

                const job = scheduler.create(options);
                return job;
            }

            case 'schedule.list': {
                return { jobs: scheduler.list() };
            }

            case 'schedule.get': {
                const id = requireString(data, 'id');
                return scheduler.get(id);
            }

            case 'schedule.delete': {
                const id = requireString(data, 'id');
                scheduler.delete(id);
                return { ok: true, id };
            }

            default:
                throw new OrchestratorError(
                    ErrorCode.UNKNOWN_ACTION,
                    `Unknown process action: "${action}"`,
                    {
                        action,
                        availableActions: [
                            'process.spawn', 'process.stop', 'process.restart',
                            'process.list', 'process.inspect', 'process.logs',
                            'schedule.create', 'schedule.list', 'schedule.get', 'schedule.delete',
                        ],
                    },
                );
        }
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requireString(data: Record<string, unknown>, field: string): string {
    const value = data[field];
    if (typeof value !== 'string' || value.length === 0) {
        throw new OrchestratorError(
            ErrorCode.VALIDATION_ERROR,
            `Missing required field: "${field}"`,
            { field },
        );
    }
    return value;
}
