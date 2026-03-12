import type {
    IRuntimeServiceProvider,
    RuntimeServiceInfo,
    RuntimeServiceType,
    RuntimeServiceStatus,
    RuntimeServiceAttachOptions,
} from '@orch/shared';
import type { PluginManager } from '@orch/plugin-manager';

export class PluginServiceProvider implements IRuntimeServiceProvider {
    public readonly type: RuntimeServiceType = 'plugin';

    constructor(
        private readonly pluginManager: PluginManager
    ) {}

    public isCritical(_id: string): boolean {
        return false;
    }

    public list(): RuntimeServiceInfo[] {
        return this.pluginManager.list().map(record => this.mapInfo(record));
    }

    public inspect(id: string): RuntimeServiceInfo {
        const record = this.pluginManager.list().find(p => p.id === id);
        if (!record) {
            throw new Error(`Plugin ${id} not found.`);
        }
        return this.mapInfo(record);
    }

    public async start(id: string): Promise<void> {
        await this.pluginManager.startPlugin(id);
    }

    public async stop(id: string): Promise<void> {
        await this.pluginManager.stopPlugin(id);
    }

    public async restart(id: string): Promise<void> {
        await this.pluginManager.restartPlugin(id);
    }

    public async *attach(id: string, _options?: RuntimeServiceAttachOptions): AsyncIterable<string | Buffer | Record<string, unknown>> {
        yield `Attached to plugin ${id}. Streaming plugin logs correctly requires daemon log hook binding.`;
    }

    private mapInfo(record: any): RuntimeServiceInfo {
        const status: RuntimeServiceStatus = record.enabled ? 'running' : 'stopped';
        return {
            id: record.id,
            name: `Plugin: ${record.manifest?.name || record.id}`,
            type: this.type,
            status,
            isCritical: false,
            metadata: {
                version: record.manifest?.version,
                permissions: record.granted_permissions,
                enabled: record.enabled,
            },
        };
    }
}
