import type {
    IRuntimeServiceProvider,
    RuntimeServiceInfo,
    RuntimeServiceType,
    RuntimeServiceStatus,
    RuntimeServiceAttachOptions,
} from '@orch/shared';
import type { ProcessManager } from '@orch/process/manager';
import type { ProcessLogManager, ProcessLogEntry } from '@orch/process/logs';
import { OrchestratorError, ErrorCode } from '@orch/shared';

export class ProcessServiceProvider implements IRuntimeServiceProvider {
    public readonly type: RuntimeServiceType = 'process';

    constructor(
        private readonly processManager: ProcessManager,
        private readonly logManager: ProcessLogManager
    ) {}

    public isCritical(_id: string): boolean {
        return false;
    }

    public list(): RuntimeServiceInfo[] {
        return this.processManager.list().map(managed => this.mapInfo(managed));
    }

    public inspect(id: string): RuntimeServiceInfo {
        const managed = this.processManager.get(id);
        if (!managed) {
            throw new OrchestratorError(ErrorCode.NOT_FOUND, `Process ${id} not found.`);
        }
        return this.mapInfo(managed);
    }

    public async start(id: string): Promise<void> {
        const managed = this.processManager.get(id);
        if (!managed) {
            throw new OrchestratorError(ErrorCode.NOT_FOUND, `Process ${id} not found.`);
        }
        if (managed.status !== 'running') {
            await this.processManager.restart(id);
        }
    }

    public async stop(id: string): Promise<void> {
        await this.processManager.stop(id);
    }

    public async restart(id: string): Promise<void> {
        await this.processManager.restart(id);
    }

    public async *attach(id: string, options?: RuntimeServiceAttachOptions): AsyncIterable<string | Buffer | Record<string, unknown>> {
        const tail = options?.tail ?? 100;
        const initialLogs = this.logManager.getLogs(id, tail);
        
        for (const log of initialLogs) {
            yield log as unknown as Record<string, unknown>;
        }

        if (options?.follow) {
            let resolveNext: (() => void) | null = null;
            const liveLogs: ProcessLogEntry[] = [];
            
            const unsubscribe = this.logManager.subscribe((entry) => {
                if (entry.processId === id) {
                    liveLogs.push(entry);
                    if (resolveNext) {
                        resolveNext();
                        resolveNext = null;
                    }
                }
            });

            try {
                while (true) {
                    if (liveLogs.length > 0) {
                        yield liveLogs.shift() as unknown as Record<string, unknown>;
                    } else {
                        await new Promise<void>((resolve) => {
                            resolveNext = resolve;
                        });
                    }
                }
            } finally {
                unsubscribe();
            }
        }
    }

    private mapInfo(managed: any): RuntimeServiceInfo {
        return {
            id: managed.id,
            name: `Process: ${managed.command}`,
            type: this.type,
            status: this.mapStatus(managed.status),
            uptime: managed.startedAt ? Date.now() - new Date(managed.startedAt).getTime() : 0,
            isCritical: false,
            metadata: {
                pid: managed.pid,
                restartCount: managed.restartCount,
                healthy: managed.healthy,
                command: managed.command,
                args: managed.args,
            },
        };
    }

    private mapStatus(status: string): RuntimeServiceStatus {
        switch (status) {
            case 'running': return 'running';
            case 'stopped': return 'stopped';
            case 'restarting': return 'starting';
            case 'failed': return 'error';
            default: return 'unknown';
        }
    }
}
