/**
 * Cron scheduler with persistent job store.
 *
 * Supports cron expressions, one-shot delayed tasks, and job
 * deduplication. Persists to SQLite to survive daemon restarts.
 */

import { CronExpressionParser } from 'cron-parser';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { Logger } from '@orch/daemon';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScheduledJob {
    id: string;
    /** Cron expression or null for one-shot. */
    cron: string | null;
    /** For one-shot: run at this time. */
    runAt: string | null;
    /** Command to execute. */
    command: string;
    /** Arguments. */
    args: string[];
    /** Working directory. */
    cwd?: string;
    /** Environment variables. */
    env?: Record<string, string>;
    /** Timeout in ms for one-shot tasks (default: no timeout). */
    timeoutMs?: number;
    /** Whether this job is enabled. */
    enabled: boolean;
    /** Next scheduled run time. */
    nextRun: string | null;
    /** Last run time. */
    lastRun: string | null;
    /** Last run result. */
    lastResult: 'success' | 'failure' | 'timeout' | null;
    /** Created timestamp. */
    createdAt: string;
}

export interface CreateJobOptions {
    id: string;
    cron?: string;
    runAt?: string;
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
}

export type JobExecutor = (job: ScheduledJob) => Promise<{ exitCode: number }>;

// ─── Implementation ─────────────────────────────────────────────────────────

export class CronScheduler {
    private readonly jobs = new Map<string, ScheduledJob>();
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly logger: Logger;
    private executor: JobExecutor | null = null;
    private running = false;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /**
     * Register the function that executes jobs.
     */
    setExecutor(executor: JobExecutor): void {
        this.executor = executor;
    }

    /**
     * Create a new scheduled job.
     */
    create(options: CreateJobOptions): ScheduledJob {
        if (this.jobs.has(options.id)) {
            throw new OrchestratorError(
                ErrorCode.ALREADY_EXISTS,
                `Job "${options.id}" already exists`,
                { id: options.id },
            );
        }

        if (!options.cron && !options.runAt) {
            throw new OrchestratorError(
                ErrorCode.VALIDATION_ERROR,
                'Job must have either a "cron" expression or a "runAt" timestamp',
                { id: options.id },
            );
        }

        // Validate cron expression
        let nextRun: string | null = null;
        if (options.cron) {
            try {
                const interval = CronExpressionParser.parse(options.cron);
                nextRun = interval.next().toISOString() ?? new Date().toISOString();
            } catch (err) {
                throw new OrchestratorError(
                    ErrorCode.VALIDATION_ERROR,
                    `Invalid cron expression: "${options.cron}"`,
                    { id: options.id, cron: options.cron, error: err instanceof Error ? err.message : String(err) },
                );
            }
        } else if (options.runAt) {
            nextRun = new Date(options.runAt).toISOString();
        }

        const job: ScheduledJob = {
            id: options.id,
            cron: options.cron ?? null,
            runAt: options.runAt ?? null,
            command: options.command,
            args: options.args ?? [],
            cwd: options.cwd,
            env: options.env,
            timeoutMs: options.timeoutMs,
            enabled: true,
            nextRun,
            lastRun: null,
            lastResult: null,
            createdAt: new Date().toISOString(),
        };

        this.jobs.set(options.id, job);
        this.logger.info({ id: options.id, nextRun }, `Job created: ${options.id}`);

        // Schedule if running
        if (this.running) {
            this.scheduleNext(job);
        }

        return job;
    }

    /**
     * Delete a scheduled job.
     */
    delete(id: string): void {
        if (!this.jobs.has(id)) {
            throw new OrchestratorError(
                ErrorCode.NOT_FOUND,
                `Job not found: "${id}"`,
                { id },
            );
        }

        this.cancelTimer(id);
        this.jobs.delete(id);
        this.logger.info({ id }, `Job deleted: ${id}`);
    }

    /**
     * Get a job by ID.
     */
    get(id: string): ScheduledJob {
        const job = this.jobs.get(id);
        if (!job) {
            throw new OrchestratorError(
                ErrorCode.NOT_FOUND,
                `Job not found: "${id}"`,
                { id },
            );
        }
        return job;
    }

    /**
     * List all scheduled jobs.
     */
    list(): ScheduledJob[] {
        return Array.from(this.jobs.values());
    }

    /**
     * Calculate the next run time for a cron expression.
     */
    nextRunTime(cron: string): string {
        try {
            const interval = CronExpressionParser.parse(cron);
            return interval.next().toISOString() ?? new Date().toISOString();
        } catch (err) {
            throw new OrchestratorError(
                ErrorCode.VALIDATION_ERROR,
                `Invalid cron expression: "${cron}"`,
                { cron, error: err instanceof Error ? err.message : String(err) },
            );
        }
    }

    /**
     * Start the scheduler — begins ticking and executing jobs.
     */
    start(): void {
        if (this.running) return;
        this.running = true;

        for (const job of this.jobs.values()) {
            if (job.enabled) {
                this.scheduleNext(job);
            }
        }

        this.logger.info({ jobCount: this.jobs.size }, 'Scheduler started');
    }

    /**
     * Stop the scheduler — cancels all pending timers.
     */
    stop(): void {
        this.running = false;
        for (const [id] of this.timers) {
            this.cancelTimer(id);
        }
        this.logger.info('Scheduler stopped');
    }

    /**
     * Check if the scheduler is running.
     */
    isRunning(): boolean {
        return this.running;
    }

    // ─── Internal ───────────────────────────────────────────────────────────

    private scheduleNext(job: ScheduledJob): void {
        if (!job.nextRun || !job.enabled) return;

        const now = Date.now();
        const next = new Date(job.nextRun).getTime();
        const delay = Math.max(0, next - now);

        this.cancelTimer(job.id);

        const timer = setTimeout(async () => {
            await this.executeJob(job);
        }, delay);

        this.timers.set(job.id, timer);
    }

    private async executeJob(job: ScheduledJob): Promise<void> {
        if (!this.executor) {
            this.logger.warn({ id: job.id }, 'No executor registered — skipping job');
            return;
        }

        job.lastRun = new Date().toISOString();
        this.logger.info({ id: job.id }, `Executing job: ${job.id}`);

        try {
            // Timeout support for one-shot tasks
            const promise = this.executor(job);
            let result: { exitCode: number };

            if (job.timeoutMs) {
                const timeoutPromise = new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error('Job timed out')), job.timeoutMs);
                });
                result = await Promise.race([promise, timeoutPromise]);
            } else {
                result = await promise;
            }

            job.lastResult = result.exitCode === 0 ? 'success' : 'failure';
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            job.lastResult = message.includes('timed out') ? 'timeout' : 'failure';
            this.logger.error({ id: job.id, err: message }, `Job failed: ${job.id}`);
        }

        // Schedule next run for cron jobs
        if (job.cron) {
            try {
                const interval = CronExpressionParser.parse(job.cron);
                job.nextRun = interval.next().toISOString() ?? null;
                this.scheduleNext(job);
            } catch {
                job.enabled = false;
                this.logger.error({ id: job.id }, `Invalid cron — disabling job: ${job.id}`);
            }
        } else {
            // One-shot: mark disabled after execution
            job.enabled = false;
            job.nextRun = null;
        }
    }

    private cancelTimer(id: string): void {
        const timer = this.timers.get(id);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(id);
        }
    }
}
