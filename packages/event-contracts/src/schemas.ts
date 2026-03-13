/**
 * Zod schemas for runtime validation of every event shape.
 *
 * Gateway and services validate inbound messages against these schemas
 * before processing — defence in depth.
 */

import { z } from 'zod';

// ─── Base ────────────────────────────────────────────────────────────────────

export const BaseEventSchema = z.object({
    traceId: z.string().min(1),
    timestamp: z.string(),
});

// ─── Inbound (Client → Gateway) ─────────────────────────────────────────────

export const InboundEventSchema = BaseEventSchema.extend({
    sessionId: z.string().min(1),
    service: z.string().min(1),
    action: z.string().min(1),
    payload: z.unknown().default({}),
});

// ─── Service Command (Gateway → Service via Redis) ──────────────────────────

export const ServiceCommandSchema = BaseEventSchema.extend({
    userId: z.string().min(1),
    roles: z.array(z.string()),
    action: z.string().min(1),
    payload: z.unknown().default({}),
    replyTo: z.string().min(1),
});

// ─── Service Result (Service → Gateway via Redis) ───────────────────────────

export const ServiceResultSchema = BaseEventSchema.extend({
    status: z.enum(['ok', 'error']),
    stream: z.string().optional(),
    payload: z.unknown().optional(),
    done: z.boolean(),
});

// ─── Audit ──────────────────────────────────────────────────────────────────

export const AuditEntrySchema = BaseEventSchema.extend({
    userId: z.string().min(1),
    action: z.string().min(1),
    service: z.string().min(1),
    step: z.string().min(1),
});

// ─── Session ────────────────────────────────────────────────────────────────

export const SessionInfoSchema = z.object({
    userId: z.string().min(1),
    roles: z.array(z.string()),
    connectedAt: z.string(),
});

// ─── Service Registry ───────────────────────────────────────────────────────

export const ServiceRegistryEntrySchema = z.object({
    serviceName: z.string().min(1),
    lastHeartbeat: z.string(),
    channels: z.array(z.string()),
});
