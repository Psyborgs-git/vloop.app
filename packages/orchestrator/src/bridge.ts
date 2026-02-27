import { Logger } from '@orch/daemon';
import { ContainerMonitor } from '@orch/container';
import { HooksEventBus } from '@orch/shared/hooks-bus';

export class SystemEventBridge {
    constructor(
        private readonly bus: HooksEventBus,
        private readonly logger: Logger
    ) {}

    public attachContainerMonitor(monitor: ContainerMonitor) {
        // ContainerMonitor emits 'event' with Docker event payload
        monitor.on('event', (event: any) => {
            // Filter or transform if needed
            // Example: container start/stop/die
            if (['start', 'stop', 'die', 'create', 'destroy'].includes(event.Action)) {
                this.bus.publish(`container.${event.Action}`, event, 'system');
            }
        });
        this.logger.info('Bridged ContainerMonitor events to HooksBus');
    }
}
