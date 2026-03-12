import type { AppTopicHandler, AppHandlerContext } from '@orch/shared';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { RuntimeServiceManager } from '../services/runtime-manager.js';

export function createServicesHandler(manager: RuntimeServiceManager): AppTopicHandler {
    return async (action: string, payload: unknown, context: AppHandlerContext) => {
        const data = (payload || {}) as Record<string, unknown>;

        // Helper to require id
        const requireId = () => {
            const id = data.id;
            if (typeof id !== 'string') {
                throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'Missing required field: id');
            }
            return id;
        };

        const requireForce = () => {
            return Boolean(data.force);
        };

        switch (action) {
            case 'list': {
                const type = data.type as any;
                if (type) {
                    return { services: await manager.listByType(type) };
                }
                return { services: await manager.list() };
            }

            case 'inspect': {
                const id = requireId();
                return await manager.inspect(id);
            }

            case 'start': {
                const id = requireId();
                await manager.start(id);
                return { success: true, id };
            }

            case 'stop': {
                const id = requireId();
                await manager.stop(id, requireForce());
                return { success: true, id };
            }

            case 'restart': {
                const id = requireId();
                await manager.restart(id, requireForce());
                return { success: true, id };
            }

            case 'attach': {
                const id = requireId();
                const tail = typeof data.tail === 'number' ? data.tail : undefined;
                const follow = typeof data.follow === 'boolean' ? data.follow : false;
                
                const stream = await manager.attach(id, { tail, follow });
                let msgCount = 0;
                
                try {
                    for await (const chunk of stream) {
                        msgCount++;
                        context.emit?.('stream', { id, chunk });
                    }
                } catch (err: any) {
                    throw new OrchestratorError(ErrorCode.INTERNAL_ERROR, `Error while streaming logs for ${id}: ${err.message}`);
                }

                return { success: true, messagesStreamed: msgCount };
            }

            default:
                throw new OrchestratorError(ErrorCode.UNKNOWN_ACTION, `Unknown services action: ${action}`);
        }
    };
}