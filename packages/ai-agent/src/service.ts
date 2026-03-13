/**
 * AI Service Worker — event-driven adapter for the ai-agent package.
 *
 * Subscribes to `ai:requests` Redis channel and delegates to the
 * existing AgentOrchestratorV2 handler infrastructure.
 *
 * The AI service worker bridges between Redis pub/sub events and
 * the existing handler pattern, translating streaming `ctx.emit()` calls
 * into Redis result channel publishes.
 */

import {
    ServiceWorker,
    CHANNELS,
} from '@orch/event-contracts';
import type { ServiceCommand, RedisLike } from '@orch/event-contracts';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Handler function matching the ai-agent's topic handler signature.
 * We accept it as a generic function to avoid coupling to @orch/daemon types.
 */
export type AgentHandlerFn = (
    action: string,
    payload: unknown,
    ctx: {
        identity?: string;
        roles?: string[];
        sessionId?: string;
        emit?: (type: string, payload: unknown) => void;
    },
) => Promise<unknown>;

export interface AiServiceConfig {
    redis: { subscriber: RedisLike; publisher: RedisLike; store: RedisLike };
    /** The agent handler function created by createAgentHandler(). */
    handler: AgentHandlerFn;
}

// ─── Service Worker ─────────────────────────────────────────────────────────

export class AiServiceWorker extends ServiceWorker {
    private handler: AgentHandlerFn;

    constructor(config: AiServiceConfig) {
        super(
            {
                serviceName: 'ai',
                commandChannel: CHANNELS.AI_REQUESTS,
            },
            config.redis,
        );
        this.handler = config.handler;
    }

    protected async handleCommand(command: ServiceCommand): Promise<void> {
        const { action, payload, userId, roles, replyTo, traceId } = command;

        // Strip "agent." prefix if present (some clients send it)
        const normalizedAction = action.startsWith('agent.') ? action.slice(6) : action;

        // Build a handler context that translates emit() into Redis publishes
        const ctx = {
            identity: userId,
            roles,
            sessionId: command.replyTo,
            emit: (type: string, data: unknown) => {
                if (type === 'stream') {
                    void this.publishResult(replyTo, {
                        traceId,
                        timestamp: new Date().toISOString(),
                        status: 'ok',
                        stream: typeof data === 'string' ? data : JSON.stringify(data),
                        done: false,
                    });
                }
            },
        };

        const result = await this.handler(normalizedAction, payload, ctx);

        await this.publishResult(replyTo, {
            traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: result,
            done: true,
        });
    }
}
