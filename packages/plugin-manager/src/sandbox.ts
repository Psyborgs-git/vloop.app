import { createPlugin } from '@extism/extism';
import type { Plugin as ExtismPlugin, CallContext } from '@extism/extism';
import type { Logger } from '@orch/daemon';
import type { PluginManifest } from './manifest.js';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { DbHostFunctions } from './host/db.js';
import type { VaultHostFunctions } from './host/vault.js';
import type { EventsHostFunctions } from './host/events.js';
import type { TaskHostFunctions } from './host/task.js';

export interface HostFunctionContext {
    logger: Logger;
    pluginId: string;
    permissions: string[];
}

export class PluginSandbox {
    private pluginPromise: Promise<ExtismPlugin>;
    private logger: Logger;
    private eventsHost?: EventsHostFunctions;

    constructor(
        manifest: PluginManifest,
        pluginDir: string,
        _permissions: string[],
        logger: Logger,
        dbHost?: DbHostFunctions,
        vaultHost?: VaultHostFunctions,
        eventsHost?: EventsHostFunctions,
        taskHost?: TaskHostFunctions
    ) {
        this.logger = logger.child({ plugin: manifest.id });
        this.eventsHost = eventsHost;
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
                            host_get_contract: (callContext: CallContext) => {
                                if (!taskHost) {
                                    callContext.setError('No task host contract available');
                                    return callContext.store('{"error":"No task host contract available"}');
                                }

                                try {
                                    return callContext.store(JSON.stringify(taskHost.getContract()));
                                } catch (err: any) {
                                    const msg = err instanceof Error ? err.message : String(err);
                                    callContext.setError(msg);
                                    return callContext.store(`{"error":${JSON.stringify(msg)}}`);
                                }
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
                            },
                            vault_read: (callContext: CallContext, _keyOffset: bigint) => {
                                // Key and value are not logged to avoid leaking sensitive metadata or secrets.
                                if (!vaultHost) {
                                    callContext.setError('No vault host functions available');
                                    return callContext.store('{"error":"No vault host functions available"}');
                                }
                                pluginLogger.warn('vault_read called; async host functions require runInWorker+JSPI');
                                callContext.setError('Async vault_read requires JSPI support');
                                return callContext.store('{"error":"Async vault_read requires JSPI support"}');
                            },
                            vault_write: (callContext: CallContext, _keyOffset: bigint, _valueOffset: bigint) => {
                                // Key and value are not logged to avoid leaking sensitive metadata or secrets.
                                if (!vaultHost) {
                                    callContext.setError('No vault host functions available');
                                    return callContext.store('{"error":"No vault host functions available"}');
                                }
                                pluginLogger.warn('vault_write called; async host functions require runInWorker+JSPI');
                                callContext.setError('Async vault_write requires JSPI support');
                                return callContext.store('{"error":"Async vault_write requires JSPI support"}');
                            },
                            contacts_manage: (callContext: CallContext, requestOffset: bigint) => {
                                if (!taskHost) {
                                    callContext.setError('No task host functions available');
                                    return callContext.store('{"error":"No task host functions available"}');
                                }

                                const request = callContext.read(requestOffset)?.string() ?? '';
                                try {
                                    return callContext.store(taskHost.manageContacts(request));
                                } catch (err: any) {
                                    const msg = err instanceof Error ? err.message : String(err);
                                    callContext.setError(msg);
                                    return callContext.store(`{"error":${JSON.stringify(msg)}}`);
                                }
                            },
                            chat_manage: (callContext: CallContext, requestOffset: bigint) => {
                                if (!taskHost) {
                                    callContext.setError('No task host functions available');
                                    return callContext.store('{"error":"No task host functions available"}');
                                }

                                const request = callContext.read(requestOffset)?.string() ?? '';
                                try {
                                    return callContext.store(taskHost.manageChat(request));
                                } catch (err: any) {
                                    const msg = err instanceof Error ? err.message : String(err);
                                    callContext.setError(msg);
                                    return callContext.store(`{"error":${JSON.stringify(msg)}}`);
                                }
                            },
                            agent_infer: (callContext: CallContext, requestOffset: bigint) => {
                                if (!taskHost) {
                                    callContext.setError('No task host functions available');
                                    return callContext.store('{"error":"No task host functions available"}');
                                }

                                const request = callContext.read(requestOffset)?.string() ?? '';
                                try {
                                    return callContext.store(taskHost.infer(request));
                                } catch (err: any) {
                                    const msg = err instanceof Error ? err.message : String(err);
                                    callContext.setError(msg);
                                    return callContext.store(`{"error":${JSON.stringify(msg)}}`);
                                }
                            },
                            notifications_notify: (callContext: CallContext, requestOffset: bigint) => {
                                if (!taskHost) {
                                    callContext.setError('No task host functions available');
                                    return callContext.store('{"error":"No task host functions available"}');
                                }

                                const request = callContext.read(requestOffset)?.string() ?? '';
                                try {
                                    return callContext.store(taskHost.notify(request));
                                } catch (err: any) {
                                    const msg = err instanceof Error ? err.message : String(err);
                                    callContext.setError(msg);
                                    return callContext.store(`{"error":${JSON.stringify(msg)}}`);
                                }
                            },
                            events_subscribe: (callContext: CallContext, topicOffset: bigint) => {
                                if (!eventsHost) {
                                    callContext.setError('No events host functions available');
                                    return callContext.store('{"error":"No events host functions available"}');
                                }
                                const topic = callContext.read(topicOffset)?.string() ?? '';
                                try {
                                    eventsHost.subscribe(topic);
                                    return callContext.store('{"ok":true}');
                                } catch (err: any) {
                                    const msg = err instanceof Error ? err.message : String(err);
                                    pluginLogger.warn({ topic }, 'events_subscribe failed');
                                    callContext.setError(msg);
                                    return callContext.store(`{"error":${JSON.stringify(msg)}}`);
                                }
                            },
                            events_publish: (callContext: CallContext, topicOffset: bigint, payloadOffset: bigint) => {
                                if (!eventsHost) {
                                    callContext.setError('No events host functions available');
                                    return callContext.store('{"error":"No events host functions available"}');
                                }
                                const topic = callContext.read(topicOffset)?.string() ?? '';
                                const payload = callContext.read(payloadOffset)?.string() ?? '';
                                try {
                                    eventsHost.publish(topic, payload);
                                    return callContext.store('{"ok":true}');
                                } catch (err: any) {
                                    const msg = err instanceof Error ? err.message : String(err);
                                    pluginLogger.warn({ topic }, 'events_publish failed');
                                    callContext.setError(msg);
                                    return callContext.store(`{"error":${JSON.stringify(msg)}}`);
                                }
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
        if (this.eventsHost) {
            this.eventsHost.cleanup();
        }
        const plugin = await this.pluginPromise;
        await plugin.close();
    }
}
