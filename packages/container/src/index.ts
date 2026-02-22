/**
 * @orch/container — Container lifecycle management via Docker Engine API.
 */

export { DockerClient } from './docker.js';
export type { DockerClientOptions, DockerInfo } from './docker.js';

export { ImageManager } from './images.js';
export type { ImageInfo, PullProgress, PullProgressCallback } from './images.js';

export { ContainerManager } from './containers.js';
export type {
    ContainerCreateOptions, ContainerInfo, ContainerInspectResult,
    PortMapping, VolumeMount,
} from './containers.js';

export { ContainerMonitor } from './monitor.js';
export type { ContainerEvent, ContainerState, MonitorOptions } from './monitor.js';

export { LogStreamer } from './logs.js';
export type { LogOptions, LogEntry, LogCallback } from './logs.js';

export { createContainerHandler } from './handler.js';
