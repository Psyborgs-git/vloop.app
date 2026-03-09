import type { Logger } from '@orch/daemon';
import type { HooksEventBus } from '@orch/shared/hooks-bus';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import {
    AgentInferenceRequestSchema,
    ChatRequestSchema,
    ContactRequestSchema,
    NotificationRequestSchema,
    PluginTaskEnvelopeSchema,
    PluginTaskHostContractSchema,
    QueuedPluginTaskResponseSchema,
    type PluginTaskEnvelope,
    type PluginTaskHostContract,
    type QueuedPluginTaskResponse,
} from '../contracts.js';
import type { PluginManifest } from '../manifest.js';

type TaskDomain = 'contacts' | 'chat' | 'ai_inference' | 'notifications';

export class TaskHostFunctions {
    constructor(
        private readonly bus: HooksEventBus | undefined,
        private readonly manifest: PluginManifest,
        private readonly pluginId: string,
        private readonly permissions: string[],
        private readonly logger: Logger,
        private readonly vaultAvailable: boolean
    ) {}

    public getContract(): PluginTaskHostContract {
        const features: PluginTaskHostContract['features'] = {
            logging: {
                info: 'log_info',
                error: 'log_error',
            },
        };

        if (this.manifest.host_features?.vault && this.vaultAvailable) {
            features.vault = {
                read: 'vault_read',
                write: 'vault_write',
                requiresJspi: true,
            };
        }

        if (this.bus && this.manifest.host_features?.contacts) {
            features.contacts = {
                request: 'contacts_manage',
                scope: 'plugin',
                transport: 'hooks-event-bus',
            };
        }

        if (this.bus && this.manifest.host_features?.chat) {
            features.chat = {
                request: 'chat_manage',
                scope: 'plugin',
                transport: 'hooks-event-bus',
            };
        }

        if (this.bus && this.manifest.host_features?.ai_inference) {
            features.ai_inference = {
                infer: 'agent_infer',
                transport: 'hooks-event-bus',
            };
        }

        if (this.bus && this.manifest.host_features?.notifications) {
            features.notifications = {
                notify: 'notifications_notify',
                topicPrefix: `notifications.plugin.${this.pluginId}`,
            };
        }

        return PluginTaskHostContractSchema.parse({
            version: 1,
            task: this.manifest.task,
            pluginId: this.pluginId,
            permissions: this.permissions,
            features,
        });
    }

    public manageContacts(requestJson: string): string {
        this.assertFeatureEnabled('contacts');
        const request = ContactRequestSchema.parse(this.parseJson(requestJson, 'contacts request'));
        const permission = request.operation === 'list' ? 'contacts:read' : 'contacts:write';

        return this.stringifyResponse(
            this.publishRequest('contacts', request.operation, request, [permission, 'contacts:*'])
        );
    }

    public manageChat(requestJson: string): string {
        this.assertFeatureEnabled('chat');
        const request = ChatRequestSchema.parse(this.parseJson(requestJson, 'chat request'));
        const permission = request.operation === 'list' ? 'chat:read' : 'chat:write';

        return this.stringifyResponse(
            this.publishRequest('chat', request.operation, request, [permission, 'chat:*'])
        );
    }

    public infer(requestJson: string): string {
        this.assertFeatureEnabled('ai_inference');
        const request = AgentInferenceRequestSchema.parse(this.parseJson(requestJson, 'agent inference request'));

        return this.stringifyResponse(
            this.publishRequest('ai_inference', request.mode, request, ['agent:run', 'agent:*'])
        );
    }

    public notify(requestJson: string): string {
        this.assertFeatureEnabled('notifications');
        const request = NotificationRequestSchema.parse(this.parseJson(requestJson, 'notification request'));
        const operation = request.topic ? 'custom' : request.channel;
        const overrideTopic = request.topic
            ? this.normalizeNotificationTopic(request.topic)
            : undefined;

        return this.stringifyResponse(
            this.publishRequest(
                'notifications',
                operation,
                request,
                ['notifications:publish', 'notifications:*'],
                overrideTopic
            )
        );
    }

    private normalizeNotificationTopic(topic: string): string {
        const topicPrefix = `notifications.plugin.${this.pluginId}.`;
        if (topic.startsWith(topicPrefix)) {
            return topic;
        }

        const normalizedTopic = topic.replace(/^\.+/, '');
        if (!normalizedTopic) {
            throw new OrchestratorError(
                ErrorCode.VALIDATION_ERROR,
                'Notification topic must contain a non-empty suffix'
            );
        }

        return `${topicPrefix}${normalizedTopic}`;
    }

    private publishRequest(
        domain: TaskDomain,
        operation: string,
        request: unknown,
        requiredPermissions: string[],
        overrideTopic?: string
    ): QueuedPluginTaskResponse {
        this.ensureBusAvailable();
        this.assertPermission(requiredPermissions);

        const topic = overrideTopic ?? `notifications.plugin.${this.pluginId}.${domain}.${operation}`;
        const payload: PluginTaskEnvelope = PluginTaskEnvelopeSchema.parse({
            pluginId: this.pluginId,
            task: this.manifest.task,
            domain,
            operation,
            request,
            requestedAt: new Date().toISOString(),
        });

        this.bus!.publish(topic, payload, this.pluginId);
        this.logger.info({ pluginId: this.pluginId, topic, domain, operation }, 'Plugin task request queued');

        return QueuedPluginTaskResponseSchema.parse({
            ok: true,
            queued: true,
            topic,
        });
    }

    private parseJson(payload: string, label: string): unknown {
        try {
            return JSON.parse(payload);
        } catch {
            throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, `Invalid JSON ${label}`);
        }
    }

    private stringifyResponse(response: QueuedPluginTaskResponse): string {
        return JSON.stringify(response);
    }

    private assertFeatureEnabled(feature: 'contacts' | 'chat' | 'ai_inference' | 'notifications'): void {
        if (!this.manifest.host_features?.[feature]) {
            throw new OrchestratorError(
                ErrorCode.PERMISSION_DENIED,
                `Plugin does not declare host feature: ${feature}`
            );
        }
    }

    private assertPermission(requiredPermissions: string[]): void {
        if (requiredPermissions.some(permission => this.permissions.includes(permission))) {
            return;
        }

        throw new OrchestratorError(
            ErrorCode.PERMISSION_DENIED,
            `Plugin lacks one of the required permissions: ${requiredPermissions.join(', ')}`
        );
    }

    private ensureBusAvailable(): void {
        if (!this.bus) {
            throw new OrchestratorError(
                ErrorCode.INTERNAL_ERROR,
                'Task host functions require HooksEventBus access'
            );
        }
    }
}
