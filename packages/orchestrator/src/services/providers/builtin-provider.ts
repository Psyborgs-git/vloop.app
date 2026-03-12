import type {
    IRuntimeServiceProvider,
    RuntimeServiceInfo,
    RuntimeServiceType,
    RuntimeServiceStatus,
    RuntimeServiceAttachOptions,
} from '@orch/shared';
import { OrchestratorError, ErrorCode } from '@orch/shared';

export interface BuiltinServiceActions {
    start?: () => Promise<void>;
    stop?: () => Promise<void>;
    restart?: () => Promise<void>;
    attach?: (options?: RuntimeServiceAttachOptions) => AsyncIterable<string | Buffer | Record<string, unknown>>;
    inspect?: () => Record<string, unknown>;
}

export interface BuiltinServiceRegistration {
    id: string;
    name: string;
    isCritical: boolean;
    actions: BuiltinServiceActions;
}

export class BuiltinServiceProvider implements IRuntimeServiceProvider {
    public readonly type: RuntimeServiceType = 'builtin';
    private services = new Map<string, BuiltinServiceRegistration>();

    public register(service: BuiltinServiceRegistration): void {
        this.services.set(service.id, service);
    }

    public isCritical(id: string): boolean {
        return this.getService(id).isCritical;
    }

    public list(): RuntimeServiceInfo[] {
        return Array.from(this.services.values()).map(s => this.mapInfo(s));
    }

    public inspect(id: string): RuntimeServiceInfo {
        return this.mapInfo(this.getService(id));
    }

    public async start(id: string): Promise<void> {
        const s = this.getService(id);
        if (s.actions.start) {
            await s.actions.start();
        } else {
            throw new Error(`Builtin service ${id} does not support start.`);
        }
    }

    public async stop(id: string): Promise<void> {
        const s = this.getService(id);
        if (s.actions.stop) {
            await s.actions.stop();
        } else {
            throw new Error(`Builtin service ${id} does not support stop.`);
        }
    }

    public async restart(id: string): Promise<void> {
        const s = this.getService(id);
        if (s.actions.restart) {
            await s.actions.restart();
        } else {
            throw new Error(`Builtin service ${id} does not support restart.`);
        }
    }

    public async *attach(id: string, options?: RuntimeServiceAttachOptions): AsyncIterable<string | Buffer | Record<string, unknown>> {
        const s = this.getService(id);
        if (s.actions.attach) {
            yield* s.actions.attach(options);
        } else {
            yield `Builtin service ${id} does not support log attaching.`;
        }
    }

    private getService(id: string): BuiltinServiceRegistration {
        const s = this.services.get(id);
        if (!s) {
            throw new OrchestratorError(ErrorCode.NOT_FOUND, `Builtin service ${id} not found.`);
        }
        return s;
    }

    private mapInfo(service: BuiltinServiceRegistration): RuntimeServiceInfo {
        const metadata = service.actions.inspect ? service.actions.inspect() : {};
        return {
            id: service.id,
            name: service.name,
            type: this.type,
            status: 'running',
            isCritical: service.isCritical,
            metadata,
        };
    }
}
