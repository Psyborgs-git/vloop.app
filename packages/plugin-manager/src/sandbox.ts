import { createPlugin } from '@extism/extism';
import type { Plugin as ExtismPlugin } from '@extism/extism';
import type { Logger } from '@orch/daemon';
import { PluginManifest } from './manifest.js';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { OrchestratorError, ErrorCode } from '@orch/shared';

export interface HostFunctionContext {
    logger: Logger;
    pluginId: string;
    permissions: string[];
}

export class PluginSandbox {
    private plugin: ExtismPlugin;
    private logger: Logger;

    constructor(
        private readonly manifest: PluginManifest,
        private readonly pluginDir: string,
        private readonly permissions: string[],
        logger: Logger
    ) {
        this.logger = logger.child({ plugin: manifest.id });
        const wasmPath = join(pluginDir, manifest.entrypoint);

        try {
            const wasmBuffer = readFileSync(wasmPath);

            this.plugin = createPlugin(
                { wasm: [{ data: wasmBuffer }] },
                {
                    useWasi: true,
                    functions: {
                        'extism:host/user': {
                            log_info: (offset: bigint) => {
                                const msg = this.plugin.getString(offset);
                                this.logger.info(msg);
                            },
                            log_error: (offset: bigint) => {
                                const msg = this.plugin.getString(offset);
                                this.logger.error(msg);
                            }
                        }
                    }
                }
            );
        } catch (err: any) {
            throw new OrchestratorError(ErrorCode.INTERNAL_ERROR, `Failed to load Wasm plugin ${manifest.id}: ${err.message}`);
        }
    }

    public async call(funcName: string, input: string | Uint8Array = ''): Promise<string> {
        try {
            const output = await this.plugin.call(funcName, input);
            return output ? output.text() : '';
        } catch (err: any) {
            this.logger.error({ err, funcName }, 'Plugin execution failed');
            throw new OrchestratorError(ErrorCode.INTERNAL_ERROR, `Plugin execution error: ${err.message}`);
        }
    }

    public async close() {
        // Extism plugins don't strictly require a close method in JS yet, but good for cleanup if added later.
    }
}
