import type { Router } from '@orch/daemon';
import type { CanvasStateManager } from './canvas-state-manager.js';

export function registerCanvasRuntimeTopic(
    router: Router,
    getStateManager: () => CanvasStateManager | undefined,
) {
    router.register('canvas', async (action, payload) => {
        const stateManager = getStateManager();
        if (!stateManager) throw new Error('Canvas runtime is not ready yet');

        const canvasId = (payload as any)?.canvasId;
        if (!canvasId || typeof canvasId !== 'string') {
            throw new Error('canvasId is required');
        }

        switch (action) {
            case 'update_state': {
                const partialState = (payload as any)?.state ?? {};
                stateManager.updateState(canvasId, partialState);
                return { canvasId, state: stateManager.getState(canvasId) };
            }
            case 'broadcast_event': {
                const type = (payload as any)?.type;
                if (!type || typeof type !== 'string') {
                    throw new Error('type is required');
                }
                stateManager.broadcast(canvasId, {
                    type,
                    payload: (payload as any)?.payload,
                    canvasId,
                });
                return { ok: true };
            }
            case 'toast': {
                const message = (payload as any)?.message;
                if (!message || typeof message !== 'string') {
                    throw new Error('message is required');
                }
                stateManager.pushToast(canvasId, {
                    message,
                    severity: (payload as any)?.severity,
                    durationMs: (payload as any)?.durationMs,
                });
                return { ok: true };
            }
            case 'request_input': {
                const message = (payload as any)?.message;
                if (!message || typeof message !== 'string') {
                    throw new Error('message is required');
                }
                return stateManager.requestInput(canvasId, {
                    title: (payload as any)?.title,
                    message,
                    placeholder: (payload as any)?.placeholder,
                    defaultValue: (payload as any)?.defaultValue,
                    confirmLabel: (payload as any)?.confirmLabel,
                    cancelLabel: (payload as any)?.cancelLabel,
                    inputType: (payload as any)?.inputType,
                    timeoutMs: (payload as any)?.timeoutMs,
                });
            }
            case 'get_state':
                return { canvasId, state: stateManager.getState(canvasId) };
            default:
                throw new Error(`Unknown canvas action: ${action}`);
        }
    });
}
