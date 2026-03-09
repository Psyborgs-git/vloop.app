import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HooksEventBus } from '@orch/shared/hooks-bus';
import type { Logger } from '@orch/daemon';
import { TaskHostFunctions } from './task.js';

const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
} as unknown as Logger;

describe('TaskHostFunctions', () => {
    let bus: HooksEventBus;

    beforeEach(() => {
        vi.clearAllMocks();
        bus = new HooksEventBus(logger as unknown as import('@orch/shared/hooks-bus').Logger);
    });

    it('builds a chat task contract with fixed host function names', () => {
        const host = new TaskHostFunctions(
            bus,
            {
                id: 'telegram-plugin',
                name: 'Telegram Plugin',
                version: '1.0.0',
                entrypoint: 'plugin.wasm',
                task: 'chat',
                host_features: {
                    logging: true,
                    vault: true,
                    contacts: true,
                    chat: true,
                    ai_inference: true,
                    notifications: true,
                },
                permissions: [],
            },
            'telegram-plugin',
            ['contacts:*', 'chat:*', 'agent:*', 'notifications:*'],
            logger,
            true
        );

        expect(host.getContract()).toEqual({
            version: 1,
            task: 'chat',
            pluginId: 'telegram-plugin',
            permissions: ['contacts:*', 'chat:*', 'agent:*', 'notifications:*'],
            features: {
                logging: {
                    info: 'log_info',
                    error: 'log_error',
                },
                vault: {
                    read: 'vault_read',
                    write: 'vault_write',
                    requiresJspi: true,
                },
                contacts: {
                    request: 'contacts_manage',
                    scope: 'plugin',
                    transport: 'hooks-event-bus',
                },
                chat: {
                    request: 'chat_manage',
                    scope: 'plugin',
                    transport: 'hooks-event-bus',
                },
                ai_inference: {
                    infer: 'agent_infer',
                    transport: 'hooks-event-bus',
                },
                notifications: {
                    notify: 'notifications_notify',
                    topicPrefix: 'notifications.plugin.telegram-plugin',
                },
            },
        });
    });

    it('publishes plugin-scoped contacts requests to the notifications bus', () => {
        const host = new TaskHostFunctions(
            bus,
            {
                id: 'discord-plugin',
                name: 'Discord Plugin',
                version: '1.0.0',
                entrypoint: 'plugin.wasm',
                task: 'chat',
                host_features: {
                    contacts: true,
                },
                permissions: [],
            },
            'discord-plugin',
            ['contacts:write'],
            logger,
            false
        );

        let received: any;
        bus.subscribe('notifications.plugin.discord-plugin.contacts.upsert', (event) => {
            received = event;
        });

        const response = JSON.parse(host.manageContacts(JSON.stringify({
            operation: 'upsert',
            contact: {
                id: 'user-1',
                displayName: 'Discord User',
                username: 'discord-user',
            },
        })));

        expect(response).toEqual({
            ok: true,
            queued: true,
            topic: 'notifications.plugin.discord-plugin.contacts.upsert',
        });
        expect(received.topic).toBe('notifications.plugin.discord-plugin.contacts.upsert');
        expect(received.source).toBe('discord-plugin');
        expect(received.payload).toMatchObject({
            pluginId: 'discord-plugin',
            task: 'chat',
            domain: 'contacts',
            operation: 'upsert',
            request: {
                operation: 'upsert',
                contact: {
                    id: 'user-1',
                    displayName: 'Discord User',
                    username: 'discord-user',
                },
            },
        });
    });

    it('rejects chat requests when the plugin lacks permission', () => {
        const host = new TaskHostFunctions(
            bus,
            {
                id: 'discord-plugin',
                name: 'Discord Plugin',
                version: '1.0.0',
                entrypoint: 'plugin.wasm',
                task: 'chat',
                host_features: {
                    chat: true,
                },
                permissions: [],
            },
            'discord-plugin',
            [],
            logger,
            false
        );

        expect(() => host.manageChat(JSON.stringify({
            operation: 'send',
            conversationId: 'conv-1',
            message: 'hello',
        }))).toThrow('Plugin lacks one of the required permissions');
    });

    it('normalizes custom notification topics into the plugin namespace', () => {
        const host = new TaskHostFunctions(
            bus,
            {
                id: 'discord-plugin',
                name: 'Discord Plugin',
                version: '1.0.0',
                entrypoint: 'plugin.wasm',
                task: 'chat',
                host_features: {
                    notifications: true,
                },
                permissions: [],
            },
            'discord-plugin',
            ['notifications:publish'],
            logger,
            false
        );

        let received: any;
        bus.subscribe('notifications.plugin.discord-plugin.alerts.critical', (event) => {
            received = event;
        });

        const response = JSON.parse(host.notify(JSON.stringify({
            topic: 'alerts.critical',
            message: 'bridge alert',
        })));

        expect(response).toEqual({
            ok: true,
            queued: true,
            topic: 'notifications.plugin.discord-plugin.alerts.critical',
        });
        expect(received.topic).toBe('notifications.plugin.discord-plugin.alerts.critical');
    });
});
