import { ErrorCode, OrchestratorError } from '@orch/shared';
import type { Logger } from '@orch/daemon';
import vm from 'node:vm';

export interface SandboxOptions {
    workspaceId: string;
    timeoutMs?: number;
}

export class AgentSandbox {
    constructor(private readonly logger: Logger) { }

    /**
     * Executes logic in a tightly controlled Javascript execution frame.
     */
    public async evaluate(code: string, opts: SandboxOptions): Promise<unknown> {
        this.logger.debug({ workspaceId: opts.workspaceId }, 'Evaluating logic in sandbox');

        const context = vm.createContext({
            console: { ...console },
            Buffer,
            setTimeout,
            clearTimeout,
            setInterval,
            clearInterval,
        });

        return new Promise((resolve, reject) => {
            try {
                const script = new vm.Script(code);
                resolve(script.runInContext(context, { timeout: opts.timeoutMs || 5000 }));
            } catch (err) {
                this.logger.error({ err }, 'Sandbox execution failed');
                reject(new OrchestratorError(ErrorCode.INTERNAL_ERROR, 'Sandbox execution failed: ' + String(err)));
            }
        });
    }
}
