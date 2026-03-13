/**
 * EventBridge — translates between WebSocket messages and Redis pub/sub.
 *
 * Inbound flow:
 *   Client WS message → validate → RBAC → publish to {service}:commands
 *
 * Outbound flow:
 *   Service publishes to {service}:results:{sessionId}
 *     → gateway subscribes → forward to client WS
 */

import type { Redis } from 'ioredis';
import {
    serviceCommandChannel,
    resultChannel,
    CHANNELS,
    ServiceCommandSchema,
    ServiceResultSchema,
    InboundEventSchema,
} from '@orch/event-contracts';
import type {
    ServiceCommand,
    ServiceResult,
    ServiceName,
    InboundEvent,
    SessionInfo,
} from '@orch/event-contracts';

/** Callback invoked when a result event arrives for a session. */
export type ResultHandler = (sessionId: string, result: ServiceResult) => void;

/**
 * EventBridge manages the Redis pub/sub lifecycle for the gateway.
 *
 * It sets up a single 'message' listener on the subscriber connection
 * and routes incoming messages to the correct per-session handler.
 */
export class EventBridge {
    private readonly handlers = new Map<string, ResultHandler>();
    private messageHandlerAttached = false;

    constructor(
        private readonly pub: Redis,
        private readonly sub: Redis,
    ) {}

    /**
     * Publish an RBAC-enriched command to a service's Redis channel.
     */
    async publishCommand(
        service: ServiceName,
        command: ServiceCommand,
    ): Promise<void> {
        const parsed = ServiceCommandSchema.parse(command);
        const channel = serviceCommandChannel(service);
        await this.pub.publish(channel, JSON.stringify(parsed));
    }

    /**
     * Subscribe to result events for a specific session.
     *
     * The gateway calls this when a client sends a request so it can
     * relay the service's response back over the WebSocket.
     */
    async subscribeResults(
        service: string,
        sessionId: string,
        handler: ResultHandler,
    ): Promise<void> {
        this.ensureMessageHandler();
        const channel = resultChannel(service, sessionId);
        this.handlers.set(channel, handler);
        await this.sub.subscribe(channel);
    }

    /**
     * Unsubscribe from a session's result channel.
     */
    async unsubscribeResults(service: string, sessionId: string): Promise<void> {
        const channel = resultChannel(service, sessionId);
        this.handlers.delete(channel);
        await this.sub.unsubscribe(channel);
    }

    /**
     * Write an entry to the audit stream via XADD.
     */
    async audit(entry: Record<string, string>): Promise<void> {
        const fields = Object.entries(entry).flat();
        await this.pub.xadd(CHANNELS.AUDIT_STREAM, '*', ...fields);
    }

    /**
     * Build a ServiceCommand from an inbound event and session info.
     */
    buildCommand(
        inbound: InboundEvent,
        session: SessionInfo,
    ): ServiceCommand {
        return {
            traceId: inbound.traceId,
            timestamp: new Date().toISOString(),
            userId: session.userId,
            roles: session.roles,
            action: inbound.action,
            payload: inbound.payload,
            replyTo: resultChannel(inbound.service, inbound.sessionId),
        };
    }

    /**
     * Validate an inbound event from the client.
     */
    validateInbound(data: unknown): InboundEvent {
        return InboundEventSchema.parse(data) as InboundEvent;
    }

    /**
     * Disconnect all subscriptions and clear handlers.
     */
    async shutdown(): Promise<void> {
        const channels = Array.from(this.handlers.keys());
        if (channels.length > 0) {
            await this.sub.unsubscribe(...channels);
        }
        this.handlers.clear();
    }

    // ─── Private ────────────────────────────────────────────────────────────

    /**
     * Attach a single 'message' listener to the subscriber connection.
     * Routes messages to the correct per-channel handler.
     */
    private ensureMessageHandler(): void {
        if (this.messageHandlerAttached) return;
        this.messageHandlerAttached = true;

        this.sub.on('message', (channel: string, message: string) => {
            const handler = this.handlers.get(channel);
            if (!handler) return;

            try {
                const parsed = ServiceResultSchema.safeParse(JSON.parse(message));
                if (!parsed.success) return;

                // Extract sessionId from channel: {service}:results:{sessionId}
                const parts = channel.split(':');
                const sessionId = parts[parts.length - 1] ?? '';
                handler(sessionId, parsed.data as ServiceResult);
            } catch {
                // Invalid JSON — skip
            }
        });
    }
}
