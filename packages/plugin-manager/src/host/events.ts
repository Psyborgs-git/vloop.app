import { HooksEventBus } from '@orch/shared';
import type { HookEvent } from '@orch/shared';
import type { Logger } from '@orch/daemon';
import { OrchestratorError, ErrorCode } from '@orch/shared';

export class EventsHostFunctions {
    // Keep track of subscriptions to cleanup
    private subscriptions: Array<{ topic: string, handler: (e: HookEvent) => void }> = [];

    constructor(
        private readonly bus: HooksEventBus,
        private readonly pluginId: string,
        private readonly permissions: string[],
        private readonly logger: Logger,
        private readonly callback: (topic: string, payload: string) => void // Callback to Wasm
    ) {}

    public subscribe(topic: string): void {
        const perm = `events:subscribe:${topic}`;
        const wildcard = `events:subscribe:*`;

        if (!this.permissions.includes(perm) && !this.permissions.includes(wildcard)) {
            throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, `Plugin denied subscription to topic: ${topic}`);
        }

        const handler = (event: HookEvent) => {
            // Marshal back to Wasm
            try {
                this.callback(event.topic, JSON.stringify(event.payload));
            } catch (err) {
                this.logger.error({ err, pluginId: this.pluginId }, 'Failed to deliver event to plugin');
            }
        };

        this.bus.subscribe(topic, handler);
        this.subscriptions.push({ topic, handler });
        this.logger.info({ pluginId: this.pluginId, topic }, 'Plugin subscribed to event');
    }

    public publish(topic: string, payloadJson: string): void {
        // Enforce namespace: plugin.<id>.*
        if (!topic.startsWith(`plugin.${this.pluginId}.`)) {
             throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, `Plugins can only publish to their own namespace (plugin.${this.pluginId}.*)`);
        }

        // Check permission if needed? Usually publishing to own namespace is implicit.

        let payload: any;
        try {
            payload = JSON.parse(payloadJson);
        } catch {
            throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'Invalid JSON payload');
        }

        this.bus.publish(topic, payload, this.pluginId);
    }

    public cleanup() {
        for (const sub of this.subscriptions) {
            this.bus.unsubscribe(sub.topic, sub.handler);
        }
        this.subscriptions = [];
    }
}
