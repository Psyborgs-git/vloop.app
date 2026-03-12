export type RuntimeServiceType = 'process' | 'plugin' | 'builtin';

export type RuntimeServiceStatus = 'running' | 'stopped' | 'error' | 'starting' | 'unknown';

export interface RuntimeServiceInfo {
    id: string;
    name?: string;
    type: RuntimeServiceType;
    status: RuntimeServiceStatus;
    uptime?: number;
    memoryUsage?: number;
    cpuUsage?: number;
    isCritical?: boolean;
    metadata?: Record<string, unknown>;
}

export interface RuntimeServiceAttachOptions {
    tail?: number;
    follow?: boolean;
}

/**
 * Interface that all manage-able units (processes, plugins, and built-in components) must implement
 * to be handled by the central RuntimeServiceManager.
 */
export interface IRuntimeServiceProvider {
    /** The service category/type this provider handles */
    readonly type: RuntimeServiceType;

    /** List all services managed by this provider */
    list(): Promise<RuntimeServiceInfo[]> | RuntimeServiceInfo[];

    /** Current full status info for a specific service */
    inspect(id: string): Promise<RuntimeServiceInfo> | RuntimeServiceInfo;

    /** Attempt to start the service */
    start(id: string): Promise<void>;

    /** Object describing if this service is allowed to be stopped/restarted dynamically */
    isCritical(id: string): boolean;

    /** Gracefully (or forcefully) stop the service */
    stop(id: string): Promise<void>;

    /** Stop and then start the service */
    restart(id: string): Promise<void>;

    /** Hook into the logging / event stream of the service */
    attach(id: string, options?: RuntimeServiceAttachOptions): AsyncIterable<string | Buffer | Record<string, unknown>>;
}
