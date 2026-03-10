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
                                } catch (err: unknown) {
                                    const msg = err instanceof Error ? err.message : String(err);
                                    callContext.setError(msg);
                                    return callContext.store(`{"error":${JSON.stringify(msg)}}`);
                                }
                            },
                            db_query: (callContext: CallContext, sqlOffset: bigint, paramsOffset: bigint) => {
                                if (!dbHost) {
                                    callContext.setError('No DB host functions available');
                                    return callContext.store('{"error":"No DB host functions available"}');
                                }
                                const sql = callContext.read(sqlOffset)?.string() ?? '';
                                const paramsStr = callContext.read(paramsOffset)?.string() ?? '[]';
                                try {
                                    const params = JSON.parse(paramsStr);
                                    const result = dbHost.query(sql, params);
                                    return callContext.store(JSON.stringify(result));
                                } catch (err: unknown) {
                                    const msg = err instanceof Error ? err.message : String(err);
                                    callContext.setError(msg);
                                    return callContext.store(`{"error":${JSON.stringify(msg)}}`);
                                }
                            },
                            vault_read: (callContext: CallContext, keyOffset: bigint) => {
                                // Key and value are not logged to avoid leaking sensitive metadata or secrets.
                                if (!vaultHost) {
                                    callContext.setError('No vault host functions available');
                                    return callContext.store('{"error":"No vault host functions available"}');
                                }
                                const key = callContext.read(keyOffset)?.string() ?? '';
                                try {
                                    const val = vaultHost.read(key);
                                    return callContext.store(val === null ? "" : val);
                                } catch (err: unknown) {
                                    const msg = err instanceof Error ? err.message : String(err);
                                    callContext.setError(msg);
                                    return callContext.store(`{"error":${JSON.stringify(msg)}}`);
                                }
                            },
                            vault_write: (callContext: CallContext, keyOffset: bigint, valueOffset: bigint) => {
                                // Key and value are not logged to avoid leaking sensitive metadata or secrets.
                                if (!vaultHost) {
                                    callContext.setError('No vault host functions available');
                                    return callContext.store('{"error":"No vault host functions available"}');
                                }
                                const key = callContext.read(keyOffset)?.string() ?? '';
                                const val = callContext.read(valueOffset)?.string() ?? '';
                                try {
                                    vaultHost.write(key, val);
                                    return callContext.store('{"ok":true}');
                                } catch (err: unknown) {
                                    const msg = err instanceof Error ? err.message : String(err);
                                    callContext.setError(msg);
                                    return callContext.store(`{"error":${JSON.stringify(msg)}}`);
                                }
                            },
                            contacts_manage: (callContext: CallContext, requestOffset: bigint) => {
                                if (!taskHost) {
                                    callContext.setError('No task host functions available');
                                    return callContext.store('{"error":"No task host functions available"}');
                                }

                                const request = callContext.read(requestOffset)?.string() ?? '';
                                try {
                                    return callContext.store(taskHost.manageContacts(request));
                                } catch (err: unknown) {
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
                                } catch (err: unknown) {
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
                                } catch (err: unknown) {
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
                                } catch (err: unknown) {
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
                                } catch (err: unknown) {
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
                                } catch (err: unknown) {
                                    const msg = err instanceof Error ? err.message : String(err);
                                    pluginLogger.warn({ topic }, 'events_publish failed');
                                    callContext.setError(msg);
                                    return callContext.store(`{"error":${JSON.stringify(msg)}}`);
                                }
                            }
                        },
                        // AssemblyScript-compiled WASM modules import env.abort for runtime panics.
                        // Provide a stub so the host module resolves correctly; log at error level
                        // so fatal plugin errors are still surfaced in structured logs.
                        'env': {
                            abort: (_callContext: CallContext, _messagePtr: number, _fileNamePtr: number, line: number, column: number) => {
                                pluginLogger.error({ line, column }, 'WASM plugin called abort (fatal runtime error)');
                            }
                        }
                    }
                }
            );
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new OrchestratorError(ErrorCode.INTERNAL_ERROR, `Failed to load Wasm plugin ${manifest.id}: ${msg}`);
        }
    }

    public async call(funcName: string, input: string | Uint8Array = ''): Promise<string> {
        try {
            const plugin = await this.pluginPromise;
            const output = await plugin.call(funcName, input);
            return output ? output.text() : '';
        } catch (err: unknown) {
            this.logger.error({ err, funcName }, 'Plugin execution failed');
            const msg = err instanceof Error ? err.message : String(err);
            throw new OrchestratorError(ErrorCode.INTERNAL_ERROR, `Plugin execution error: ${msg}`);
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
