import { createPlugin } from '@extism/extism';
import type { Plugin as ExtismPlugin, CallContext } from '@extism/extism';
import type { Logger } from '@orch/daemon';
import type { PluginManifest } from './manifest.js';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { DbHostFunctions } from './host/db.js';

export interface HostFunctionContext {
    logger: Logger;
    pluginId: string;
    permissions: string[];
}

export class PluginSandbox {
    private pluginPromise: Promise<ExtismPlugin>;
    private logger: Logger;

    constructor(
        manifest: PluginManifest,
        pluginDir: string,
        _permissions: string[],
        logger: Logger,
        dbHost?: DbHostFunctions
    ) {
        this.logger = logger.child({ plugin: manifest.id });
        const wasmPath = join(pluginDir, manifest.entrypoint);

        try {
            const wasmBuffer = readFileSync(wasmPath);
            const pluginLogger = this.logger;

            this.pluginPromise = createPlugin(
                { wasm: [{ data: wasmBuffer }] },
                {
                    useWasi: true,
                    functions: {
                        'extism:host/user': {
                            log_info: (callContext: CallContext, offset: bigint) => {
                                const msg = callContext.read(offset)?.string() ?? '';
                                pluginLogger.info(msg);
                            },
                            log_error: (callContext: CallContext, offset: bigint) => {
                                const msg = callContext.read(offset)?.string() ?? '';
                                pluginLogger.error(msg);
                            },
                            db_query: (callContext: CallContext, sqlOffset: bigint, _paramsOffset: bigint) => {
                                if (!dbHost) {
                                    callContext.setError('No DB host functions available');
                                    return callContext.store('{"error":"No DB host functions available"}');
                                }
                                const sql = callContext.read(sqlOffset)?.string() ?? '';
                                // dbHost.query is async but better-sqlite3 operations are sync internally
                                // We set an error since async host functions require JSPI support
                                pluginLogger.warn({ sql }, 'db_query called; async host functions require runInWorker+JSPI');
                                callContext.setError('Async db_query requires JSPI support');
                                return callContext.store('{"error":"Async db_query requires JSPI support"}');
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
            const plugin = await this.pluginPromise;
            const output = await plugin.call(funcName, input);
            return output ? output.text() : '';
        } catch (err: any) {
            this.logger.error({ err, funcName }, 'Plugin execution failed');
            throw new OrchestratorError(ErrorCode.INTERNAL_ERROR, `Plugin execution error: ${err.message}`);
        }
    }

    public async close() {
        const plugin = await this.pluginPromise;
        await plugin.close();
    }
}
