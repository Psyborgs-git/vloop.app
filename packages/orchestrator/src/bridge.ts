import { Logger } from '@orch/daemon';
import type { ContainerEvent, ContainerState } from '@orch/container';
import { ContainerMonitor } from '@orch/container';
import { HooksEventBus } from '@orch/shared/hooks-bus';

const STATE_ACTION_MAP: Partial<Record<ContainerState, string>> = {
    running: 'start',
    stopped: 'stop',
    dead: 'die',
    created: 'create',
    removing: 'destroy',
    restarting: 'restart',
    paused: 'pause',
};

export class SystemEventBridge {
    constructor(
        private readonly bus: HooksEventBus,
        private readonly logger: Logger
    ) {}

    public attachContainerMonitor(monitor: ContainerMonitor) {
        monitor.on('stateChange', (event: ContainerEvent) => {
            const action = STATE_ACTION_MAP[event.currentState];
            if (action) {
                this.bus.publish(`container.${action}`, event, 'system');
            }
        });
        this.logger.info('Bridged ContainerMonitor events to HooksBus');
    }
}
