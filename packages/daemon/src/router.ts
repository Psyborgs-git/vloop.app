/**
 * Topic/Action message router with middleware support.
 *
 * The Router dispatches validated requests to registered topic handlers.
 * Middleware is executed in order before the handler, enabling cross-cutting
 * concerns like auth, RBAC, rate-limiting, and audit logging.
 */

import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { Request, Response } from './protocol.js';
import { buildErrorResponse, buildResultResponse } from './protocol.js';
import type { Logger } from './logging.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Context passed through the middleware pipeline and to handlers. */
export interface HandlerContext {
    /** The parsed, validated request. */
    request: Request;
    /** Session identity (set by auth middleware). */
    identity?: string;
    /** Session roles (set by auth middleware). */
    roles?: string[];
    /** Session ID (set by auth middleware). */
    sessionId?: string;
    /** Per-request logger with trace_id binding. */
    logger: Logger;
    /** Arbitrary context data set by middleware. */
    state: Map<string, unknown>;
    /** Optional callback to emit intermediate streaming payloads. */
    emit?: (type: 'stream' | 'event', payload: unknown, seq?: number) => void;
}

/**
 * A topic handler processes a request and returns a response payload.
 * The router wraps the payload into a full Response envelope.
 */
export type TopicHandler = (
    action: string,
    payload: unknown,
    context: HandlerContext,
) => Promise<unknown> | unknown;

/**
 * Middleware function. Call `next()` to pass to the next middleware or handler.
 * Middleware can modify the context, short-circuit with an error, or run
 * post-processing after `next()` returns.
 */
export type Middleware = (
    context: HandlerContext,
    next: () => Promise<Response>,
) => Promise<Response>;

// ─── Router Implementation ──────────────────────────────────────────────────

export class Router {
    private handlers = new Map<string, TopicHandler>();
    private middlewares: Middleware[] = [];
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /**
     * Register a topic handler.
     * Each topic can only have one handler.
     */
    register(topic: string, handler: TopicHandler): void {
        if (this.handlers.has(topic)) {
            this.logger.warn({ topic }, `Overwriting existing handler for topic: ${topic}`);
        }
        this.handlers.set(topic, handler);
        this.logger.info({ topic }, `Registered handler for topic: ${topic}`);
    }

    /**
     * Add a middleware to the pipeline.
     * Middleware executes in the order added (first added = outermost).
     */
    use(middleware: Middleware): void {
        this.middlewares.push(middleware);
    }

    /**
     * List all registered topic names.
     */
    topics(): string[] {
        return Array.from(this.handlers.keys());
    }

    /**
     * Dispatch a request through the middleware pipeline and to the handler.
     * Returns a fully formed Response envelope.
     *
     * Errors are caught and returned as error responses — the router never throws.
     */
    async dispatch(
        request: Request,
        logger: Logger,
        emit?: (type: 'stream' | 'event', payload: unknown, seq?: number) => void
    ): Promise<Response> {
        const context: HandlerContext = {
            request,
            logger,
            state: new Map(),
            emit,
        };

        try {
            // Build the handler call (innermost function)
            const handler = this.handlers.get(request.topic);
            if (!handler) {
                throw new OrchestratorError(
                    ErrorCode.UNKNOWN_TOPIC,
                    `No handler registered for topic: ${request.topic}`,
                    { topic: request.topic, available: this.topics() },
                );
            }

            // Build middleware chain (onion model)
            const chain = this.buildChain(context, handler);

            return await chain();
        } catch (err) {
            const orchErr = OrchestratorError.from(err);

            logger.error(
                { err: orchErr, topic: request.topic, action: request.action },
                `Request failed: ${orchErr.message}`,
            );

            return buildErrorResponse(
                request.id,
                request.topic,
                request.action,
                orchErr,
                request.meta.trace_id,
            );
        }
    }

    /**
     * Build the middleware + handler chain as a nested function stack.
     */
    private buildChain(
        context: HandlerContext,
        handler: TopicHandler,
    ): () => Promise<Response> {
        // The innermost function: call the handler
        const innermost = async (): Promise<Response> => {
            const payload = await handler(
                context.request.action,
                context.request.payload,
                context,
            );

            return buildResultResponse(
                context.request.id,
                context.request.topic,
                context.request.action,
                payload,
                context.request.meta.trace_id,
            );
        };

        // Wrap with middleware from inside out
        // middlewares[0] is outermost, middlewares[last] is innermost
        let next = innermost;

        for (let i = this.middlewares.length - 1; i >= 0; i--) {
            const mw = this.middlewares[i]!;
            const currentNext = next;
            next = () => mw(context, currentNext);
        }

        return next;
    }
}
