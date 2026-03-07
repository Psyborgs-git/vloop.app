import { z } from 'zod';

export const PluginTaskSchema = z.enum(['chat']);
export type PluginTask = z.infer<typeof PluginTaskSchema>;

export const PluginHostFeatureFlagsSchema = z.object({
    logging: z.boolean().optional(),
    vault: z.boolean().optional(),
    contacts: z.boolean().optional(),
    chat: z.boolean().optional(),
    ai_inference: z.boolean().optional(),
    notifications: z.boolean().optional(),
});

export type PluginHostFeatureFlags = z.infer<typeof PluginHostFeatureFlagsSchema>;

const MetadataSchema = z.record(z.string(), z.unknown()).optional();

export const PluginScopedContactSchema = z.object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    username: z.string().optional(),
    channel: z.string().optional(),
    metadata: MetadataSchema,
});

export type PluginScopedContact = z.infer<typeof PluginScopedContactSchema>;

export const ContactRequestSchema = z.discriminatedUnion('operation', [
    z.object({
        operation: z.literal('upsert'),
        contact: PluginScopedContactSchema,
    }),
    z.object({
        operation: z.literal('remove'),
        contactId: z.string().min(1),
    }),
    z.object({
        operation: z.literal('list'),
        search: z.string().optional(),
        limit: z.number().int().positive().max(200).optional(),
    }),
]);

export type ContactRequest = z.infer<typeof ContactRequestSchema>;

export const ChatRequestSchema = z.discriminatedUnion('operation', [
    z.object({
        operation: z.literal('send'),
        conversationId: z.string().min(1),
        recipientId: z.string().optional(),
        message: z.string().min(1),
        metadata: MetadataSchema,
    }),
    z.object({
        operation: z.literal('list'),
        conversationId: z.string().optional(),
        limit: z.number().int().positive().max(200).optional(),
    }),
    z.object({
        operation: z.literal('archive'),
        conversationId: z.string().min(1),
    }),
]);

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const AgentInferenceRequestSchema = z.object({
    prompt: z.string().min(1),
    conversationId: z.string().optional(),
    model: z.string().optional(),
    mode: z.enum(['reply', 'plan', 'tool']).default('reply'),
    metadata: MetadataSchema,
});

export type AgentInferenceRequest = z.infer<typeof AgentInferenceRequestSchema>;

export const NotificationRequestSchema = z.object({
    title: z.string().optional(),
    message: z.string().min(1),
    channel: z.enum(['event', 'toast', 'email', 'webhook']).default('event'),
    topic: z.string().optional(),
    metadata: MetadataSchema,
});

export type NotificationRequest = z.infer<typeof NotificationRequestSchema>;

export const PluginTaskEnvelopeSchema = z.object({
    pluginId: z.string().min(1),
    task: PluginTaskSchema,
    domain: z.enum(['contacts', 'chat', 'ai_inference', 'notifications']),
    operation: z.string().min(1),
    request: z.unknown(),
    requestedAt: z.string().min(1),
});

export type PluginTaskEnvelope = z.infer<typeof PluginTaskEnvelopeSchema>;

export const QueuedPluginTaskResponseSchema = z.object({
    ok: z.literal(true),
    queued: z.literal(true),
    topic: z.string().min(1),
});

export type QueuedPluginTaskResponse = z.infer<typeof QueuedPluginTaskResponseSchema>;

export const PluginTaskHostContractSchema = z.object({
    version: z.literal(1),
    task: PluginTaskSchema,
    pluginId: z.string().min(1),
    permissions: z.array(z.string()),
    features: z.object({
        logging: z.object({
            info: z.literal('log_info'),
            error: z.literal('log_error'),
        }),
        vault: z.object({
            read: z.literal('vault_read'),
            write: z.literal('vault_write'),
        }).optional(),
        contacts: z.object({
            request: z.literal('contacts_manage'),
            scope: z.literal('plugin'),
            transport: z.literal('hooks-event-bus'),
        }).optional(),
        chat: z.object({
            request: z.literal('chat_manage'),
            scope: z.literal('plugin'),
            transport: z.literal('hooks-event-bus'),
        }).optional(),
        ai_inference: z.object({
            infer: z.literal('agent_infer'),
            transport: z.literal('hooks-event-bus'),
        }).optional(),
        notifications: z.object({
            notify: z.literal('notifications_notify'),
            topicPrefix: z.string().min(1),
        }).optional(),
    }),
});

export type PluginTaskHostContract = z.infer<typeof PluginTaskHostContractSchema>;
