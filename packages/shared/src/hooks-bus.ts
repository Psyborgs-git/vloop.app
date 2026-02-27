import { EventEmitter } from 'node:events';

// Define minimal Logger interface to break circular dependency if possible,
// or just use generic Record for now if strict type isn't needed.
// However, the issue is that `@orch/shared` depends on `@orch/daemon` for `Logger` type,
// but `@orch/daemon` likely depends on `@orch/shared` for something else (e.g. errors).
// Yes, `daemon/src/router.ts` imports `OrchestratorError` from `@orch/shared`.
// Circular dependency detected: shared -> daemon -> shared.

// Solution: Move HooksEventBus to `packages/daemon` or define Logger interface in `shared`.
// Given `HooksEventBus` is for plugins and core, it fits in `daemon`.
// OR define a `Logger` interface in `shared` that `daemon` implements.

// Let's redefine Logger here to avoid import.
export interface Logger {
    info(msg: string, ...args: any[]): void;
    info(obj: object, msg?: string, ...args: any[]): void;
    debug(msg: string, ...args: any[]): void;
    debug(obj: object, msg?: string, ...args: any[]): void;
    warn(msg: string, ...args: any[]): void;
    warn(obj: object, msg?: string, ...args: any[]): void;
    error(msg: string, ...args: any[]): void;
    error(obj: object, msg?: string, ...args: any[]): void;
    child(bindings: Record<string, any>): Logger;
}

export interface HookEvent {
    topic: string;
    payload: any;
    source: string; // 'system' or plugin ID
    timestamp: string;
}

export class HooksEventBus extends EventEmitter {
    constructor(private readonly logger: Logger) {
        super();
        this.logger.info('Hooks Event Bus initialized');
    }

    public publish(topic: string, payload: any, source: string = 'system'): void {
        const event: HookEvent = {
            topic,
            payload,
            source,
            timestamp: new Date().toISOString()
        };

        this.emit(topic, event);
        this.emit('*', event); // Global firehose (be careful)

        this.logger.debug({ topic, source }, 'Event published to Hooks Bus');
    }

    public subscribe(topic: string, handler: (event: HookEvent) => void): void {
        this.on(topic, handler);
    }

    public unsubscribe(topic: string, handler: (event: HookEvent) => void): void {
        this.off(topic, handler);
    }
}
