import type {
    IRuntimeServiceProvider,
    RuntimeServiceInfo,
    RuntimeServiceType,
    RuntimeServiceAttachOptions,
} from '@orch/shared';
import { OrchestratorError, ErrorCode } from '@orch/shared';

export class RuntimeServiceManager {
    private providers: Map<RuntimeServiceType, IRuntimeServiceProvider> = new Map();

    /**
     * Register a new service provider
     */
    public register(provider: IRuntimeServiceProvider): void {
        this.providers.set(provider.type, provider);
    }

    /**
     * List all registered services and their current status
     */
    public async list(): Promise<RuntimeServiceInfo[]> {
        let allInfos: RuntimeServiceInfo[] = [];
        for (const provider of this.providers.values()) {
            allInfos = allInfos.concat(await provider.list());
        }
        return allInfos;
    }

    /**
     * List services of a specific type
     */
    public async listByType(type: RuntimeServiceType): Promise<RuntimeServiceInfo[]> {
        const provider = this.providers.get(type);
        if (!provider) return [];
        return await provider.list();
    }

    /**
     * Get details for a specific service
     */
    public async inspect(id: string): Promise<RuntimeServiceInfo> {
        const provider = await this.findProvider(id);
        return await provider.inspect(id);
    }

    /**
     * Start a service
     */
    public async start(id: string): Promise<void> {
        const provider = await this.findProvider(id);
        await provider.start(id);
    }

    /**
     * Stop a service, obeying criticality checks unless explicitly overridden
     */
    public async stop(id: string, force: boolean = false): Promise<void> {
        const provider = await this.findProvider(id);
        if (provider.isCritical(id) && !force) {
            throw new OrchestratorError(
                ErrorCode.VALIDATION_ERROR,
                `Service '${id}' is marked as critical and cannot be stopped without 'force' flag.`
            );
        }
        await provider.stop(id);
    }

    /**
     * Restart a service
     */
    public async restart(id: string, force: boolean = false): Promise<void> {
        const provider = await this.findProvider(id);
        if (provider.isCritical(id) && !force) {
            throw new OrchestratorError(
                ErrorCode.VALIDATION_ERROR,
                `Service '${id}' is marked as critical and cannot be restarted without 'force' flag.`
            );
        }
        await provider.restart(id);
    }

    /**
     * Stream logs/events from a service
     */
    public async attach(id: string, options?: RuntimeServiceAttachOptions): Promise<AsyncIterable<string | Buffer | Record<string, unknown>>> {
        const provider = await this.findProvider(id);
        return provider.attach(id, options);
    }

    private async findProvider(id: string): Promise<IRuntimeServiceProvider> {
        for (const provider of this.providers.values()) {
            try {
                // Determine if this provider handles this ID by trying to inspect it.
                // Or provider.list() and find it.
                const infos = await provider.list();
                if (infos.some(i => i.id === id)) {
                    return provider;
                }
            } catch {
                // Ignore and continue search
            }
        }
        throw new OrchestratorError(
            ErrorCode.NOT_FOUND,
            `Service '${id}' not found in any runtime provider.`
        );
    }
}
