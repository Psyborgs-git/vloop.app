import { EventEmitter } from "node:events";
import type { Logger } from "@orch/daemon";

export class HookService extends EventEmitter {
    private logger: Logger;

    constructor(logger: Logger) {
        super();
        this.logger = logger;
    }

    /**
     * Emit an event that plugins can listen to.
     */
    emitHook(event: string, payload: any): boolean {
        this.logger.debug({ event }, `Emitting hook: ${event}`);
        return super.emit(event, payload);
    }

    /**
     * Register a listener for a specific hook.
     */
    register(event: string, callback: (payload: any) => void): void {
        this.logger.debug({ event }, `Registered listener for hook: ${event}`);
        this.on(event, (payload) => {
            try {
                callback(payload);
            } catch (err) {
                this.logger.error({ err, event }, "Error in hook listener");
            }
        });
    }

    /**
     * List all active listeners.
     */
    list(): string[] {
        return this.eventNames() as string[];
    }
}
