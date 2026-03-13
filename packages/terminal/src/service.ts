/**
 * Terminal Service Worker — event-driven adapter for the terminal package.
 *
 * Subscribes to `terminal:commands` Redis channel and delegates to the
 * existing TerminalManager, ProfileManager, and SessionLogger.
 *
 * This is the bridge between the new event-driven architecture and the
 * existing terminal implementation. The handler logic remains unchanged —
 * only the transport layer changes from WebSocket direct calls to Redis pub/sub.
 */

import {
    ServiceWorker,
    CHANNELS,
    resultChannel,
} from '@orch/event-contracts';
import type { ServiceCommand, ServiceResult, RedisLike } from '@orch/event-contracts';
import type { TerminalManager } from './manager.js';
import type { TerminalProfileManager } from './profiles.js';
import type { SessionLogger } from './logger.js';
import type { TerminalSessionStore } from './sessions.js';
import {
    checkAccess,
    validateShell,
    validateInput,
    DEFAULT_TERMINAL_POLICY,
} from './permissions.js';
import type { TerminalPolicy } from './permissions.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TerminalServiceConfig {
    /** Redis connections (sub/pub/store trio). */
    redis: { subscriber: RedisLike; publisher: RedisLike; store: RedisLike };
    /** Terminal manager instance. */
    manager: TerminalManager;
    /** Profile manager instance. */
    profileManager: TerminalProfileManager;
    /** Session logger instance. */
    sessionLogger: SessionLogger;
    /** Optional session store for historical sessions. */
    sessionStore?: TerminalSessionStore;
    /** Terminal policy. Defaults to DEFAULT_TERMINAL_POLICY. */
    policy?: TerminalPolicy;
}

// ─── Service Worker ─────────────────────────────────────────────────────────

export class TerminalServiceWorker extends ServiceWorker {
    private manager: TerminalManager;
    private profileManager: TerminalProfileManager;
    private sessionLogger: SessionLogger;
    private sessionStore?: TerminalSessionStore;
    private policy: TerminalPolicy;
    private publisher: RedisLike;

    constructor(config: TerminalServiceConfig) {
        super(
            {
                serviceName: 'terminal',
                commandChannel: CHANNELS.TERMINAL_COMMANDS,
            },
            config.redis,
        );
        this.manager = config.manager;
        this.profileManager = config.profileManager;
        this.sessionLogger = config.sessionLogger;
        this.sessionStore = config.sessionStore;
        this.policy = config.policy ?? DEFAULT_TERMINAL_POLICY;
        this.publisher = config.redis.publisher;
    }

    protected async handleCommand(command: ServiceCommand): Promise<void> {
        const { action, payload, userId, roles, replyTo, traceId } = command;
        const data = (payload ?? {}) as Record<string, unknown>;

        switch (action) {
            case 'spawn':
                return this.handleSpawn(data, userId, roles, replyTo, traceId);
            case 'write':
                return this.handleWrite(data, userId, roles, replyTo, traceId);
            case 'resize':
                return this.handleResize(data, userId, roles, replyTo, traceId);
            case 'kill':
                return this.handleKill(data, userId, roles, replyTo, traceId);
            case 'list':
                return this.handleList(userId, roles, replyTo, traceId);
            case 'scrollback':
                return this.handleScrollback(data, userId, roles, replyTo, traceId);
            case 'session.list':
                return this.handleSessionList(data, userId, roles, replyTo, traceId);
            case 'session.get':
                return this.handleSessionGet(data, userId, roles, replyTo, traceId);
            case 'session.logs':
                return this.handleSessionLogs(data, userId, roles, replyTo, traceId);
            case 'profile.list':
                return this.handleProfileList(data, userId, roles, replyTo, traceId);
            case 'profile.create':
                return this.handleProfileCreate(data, userId, replyTo, traceId);
            case 'profile.update':
                return this.handleProfileUpdate(data, userId, roles, replyTo, traceId);
            case 'profile.delete':
                return this.handleProfileDelete(data, userId, roles, replyTo, traceId);
            default:
                await this.publishError(replyTo, traceId, `Unknown terminal action: "${action}"`);
        }
    }

    // ── Action Handlers ─────────────────────────────────────────────────

    private async handleSpawn(
        data: Record<string, unknown>,
        userId: string,
        roles: string[],
        replyTo: string,
        traceId: string,
    ): Promise<void> {
        const sessionCount = this.manager.countByOwner(userId);
        const access = checkAccess(userId, roles, sessionCount, this.policy);
        if (!access.allowed) {
            await this.publishError(replyTo, traceId, access.reason ?? 'Terminal access denied');
            return;
        }

        const shell = (data['shell'] as string) || undefined;
        if (shell) {
            const shellCheck = validateShell(shell, this.policy);
            if (!shellCheck.allowed) {
                await this.publishError(replyTo, traceId, shellCheck.reason ?? 'Shell not allowed');
                return;
            }
        }

        const sessionId = (data['sessionId'] as string) ||
            `term_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const info = this.manager.spawn({
            sessionId,
            shell,
            args: data['args'] as string[] | undefined,
            cwd: data['cwd'] as string | undefined,
            env: data['env'] as Record<string, string> | undefined,
            cols: data['cols'] as number | undefined,
            rows: data['rows'] as number | undefined,
            owner: userId,
            profileId: data['profileId'] as string | undefined,
        });

        this.sessionLogger.startRecording({
            sessionId,
            owner: info.owner,
            shell: info.shell,
            cwd: info.cwd,
            cols: info.cols,
            rows: info.rows,
            profileId: info.profileId,
        });

        // Wire PTY output → Redis pub/sub stream
        const dataHandler = (_sid: string, output: string) => {
            if (_sid !== sessionId) return;
            this.sessionLogger.appendData(sessionId, output);
            void this.publishResult(replyTo, {
                traceId,
                timestamp: new Date().toISOString(),
                status: 'ok',
                stream: output,
                done: false,
            });
        };

        const exitHandler = (_sid: string, exitCode: number, signal?: number) => {
            if (_sid !== sessionId) return;
            this.sessionLogger.stopRecording(sessionId, exitCode);
            void this.publishResult(replyTo, {
                traceId,
                timestamp: new Date().toISOString(),
                status: 'ok',
                payload: { sessionId, type: 'exit', exitCode, signal },
                done: true,
            });
            this.manager.removeListener('data', dataHandler);
            this.manager.removeListener('exit', exitHandler);
        };

        this.manager.on('data', dataHandler);
        this.manager.on('exit', exitHandler);

        // Send the initial session info as the first result
        await this.publishResult(replyTo, {
            traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: info,
            done: false,
        });
    }

    private async handleWrite(
        data: Record<string, unknown>,
        userId: string,
        roles: string[],
        replyTo: string,
        traceId: string,
    ): Promise<void> {
        const sessionId = data['sessionId'] as string;
        if (!sessionId) {
            await this.publishError(replyTo, traceId, 'Missing required field: "sessionId"');
            return;
        }
        const input = (data['data'] as string) ?? '';
        const session = this.manager.get(sessionId);
        if (!session) {
            await this.publishError(replyTo, traceId, `Session not found: ${sessionId}`);
            return;
        }
        if (session.owner !== userId && !roles.includes('admin')) {
            await this.publishError(replyTo, traceId, 'Not session owner');
            return;
        }
        const inputCheck = validateInput(input, this.policy);
        if (!inputCheck.allowed) {
            await this.publishError(replyTo, traceId, inputCheck.reason ?? 'Input blocked by policy');
            return;
        }
        this.manager.write(sessionId, input);
        await this.publishResult(replyTo, {
            traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: { ok: true },
            done: true,
        });
    }

    private async handleResize(
        data: Record<string, unknown>,
        userId: string,
        roles: string[],
        replyTo: string,
        traceId: string,
    ): Promise<void> {
        const sessionId = data['sessionId'] as string;
        if (!sessionId) {
            await this.publishError(replyTo, traceId, 'Missing required field: "sessionId"');
            return;
        }
        const cols = (data['cols'] as number) ?? 80;
        const rows = (data['rows'] as number) ?? 24;
        const session = this.manager.get(sessionId);
        if (!session) {
            await this.publishResult(replyTo, {
                traceId,
                timestamp: new Date().toISOString(),
                status: 'ok',
                payload: { ok: true, cols, rows },
                done: true,
            });
            return;
        }
        if (session.owner !== userId && !roles.includes('admin')) {
            await this.publishError(replyTo, traceId, 'Not session owner');
            return;
        }
        this.manager.resize(sessionId, cols, rows);
        await this.publishResult(replyTo, {
            traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: { ok: true, cols, rows },
            done: true,
        });
    }

    private async handleKill(
        data: Record<string, unknown>,
        userId: string,
        roles: string[],
        replyTo: string,
        traceId: string,
    ): Promise<void> {
        const sessionId = data['sessionId'] as string;
        if (!sessionId) {
            await this.publishError(replyTo, traceId, 'Missing required field: "sessionId"');
            return;
        }
        const session = this.manager.get(sessionId);
        if (!session) {
            await this.publishError(replyTo, traceId, `Session not found: ${sessionId}`);
            return;
        }
        if (session.owner !== userId && !roles.includes('admin')) {
            await this.publishError(replyTo, traceId, 'Not session owner');
            return;
        }
        this.sessionLogger.stopRecording(sessionId, undefined);
        this.manager.kill(sessionId);
        await this.publishResult(replyTo, {
            traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: { ok: true, sessionId },
            done: true,
        });
    }

    private async handleList(
        userId: string,
        roles: string[],
        replyTo: string,
        traceId: string,
    ): Promise<void> {
        const sessions = this.manager.list();
        const filtered = roles.includes('admin')
            ? sessions
            : sessions.filter((s) => s.owner === userId);
        await this.publishResult(replyTo, {
            traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: { sessions: filtered },
            done: true,
        });
    }

    private async handleScrollback(
        data: Record<string, unknown>,
        userId: string,
        roles: string[],
        replyTo: string,
        traceId: string,
    ): Promise<void> {
        const sessionId = data['sessionId'] as string;
        if (!sessionId) {
            await this.publishError(replyTo, traceId, 'Missing required field: "sessionId"');
            return;
        }
        const lines = data['lines'] as number | undefined;
        const session = this.manager.get(sessionId);
        if (!session) {
            await this.publishError(replyTo, traceId, `Session not found: ${sessionId}`);
            return;
        }
        if (session.owner !== userId && !roles.includes('admin')) {
            await this.publishError(replyTo, traceId, 'Not session owner');
            return;
        }
        await this.publishResult(replyTo, {
            traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: { sessionId, content: this.sessionLogger.getScrollback(sessionId, lines) },
            done: true,
        });
    }

    private async handleSessionList(
        data: Record<string, unknown>,
        userId: string,
        roles: string[],
        replyTo: string,
        traceId: string,
    ): Promise<void> {
        if (!this.sessionStore) {
            await this.publishResult(replyTo, {
                traceId,
                timestamp: new Date().toISOString(),
                status: 'ok',
                payload: { sessions: [] },
                done: true,
            });
            return;
        }
        const owner = roles.includes('admin')
            ? (data['owner'] as string | undefined)
            : userId;
        const limitRaw = (data['limit'] as number | undefined) ?? 100;
        const limit = Number.isFinite(limitRaw)
            ? Math.max(1, Math.min(500, Math.floor(limitRaw)))
            : 100;
        const result = this.sessionStore.list(owner, { limit });
        await this.publishResult(replyTo, {
            traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: result,
            done: true,
        });
    }

    private async handleSessionGet(
        data: Record<string, unknown>,
        userId: string,
        roles: string[],
        replyTo: string,
        traceId: string,
    ): Promise<void> {
        if (!this.sessionStore) {
            await this.publishError(replyTo, traceId, 'Session store not available');
            return;
        }
        const sessionId = data['sessionId'] as string;
        if (!sessionId) {
            await this.publishError(replyTo, traceId, 'Missing required field: "sessionId"');
            return;
        }
        const record = this.sessionStore.get(sessionId);
        if (!record) {
            await this.publishError(replyTo, traceId, `Session record not found: ${sessionId}`);
            return;
        }
        if (record.owner !== userId && !roles.includes('admin')) {
            await this.publishError(replyTo, traceId, 'Not session owner');
            return;
        }
        await this.publishResult(replyTo, {
            traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: record,
            done: true,
        });
    }

    private async handleSessionLogs(
        data: Record<string, unknown>,
        userId: string,
        roles: string[],
        replyTo: string,
        traceId: string,
    ): Promise<void> {
        const sessionId = data['sessionId'] as string;
        if (!sessionId) {
            await this.publishError(replyTo, traceId, 'Missing required field: "sessionId"');
            return;
        }
        const live = this.manager.get(sessionId);
        if (live && live.owner !== userId && !roles.includes('admin')) {
            await this.publishError(replyTo, traceId, 'Not session owner');
            return;
        }
        if (!live) {
            if (!this.sessionStore) {
                await this.publishError(replyTo, traceId, `Session not found: ${sessionId}`);
                return;
            }
            const record = this.sessionStore.get(sessionId);
            if (!record) {
                await this.publishError(replyTo, traceId, `Session not found: ${sessionId}`);
                return;
            }
            if (record.owner !== userId && !roles.includes('admin')) {
                await this.publishError(replyTo, traceId, 'Not session owner');
                return;
            }
        }
        const content = this.sessionLogger.getLogContent(sessionId);
        await this.publishResult(replyTo, {
            traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: { sessionId, content: content ?? '' },
            done: true,
        });
    }

    private async handleProfileList(
        data: Record<string, unknown>,
        userId: string,
        roles: string[],
        replyTo: string,
        traceId: string,
    ): Promise<void> {
        const owner = (data['owner'] as string) || userId;
        const actualOwner = roles.includes('admin') ? owner : userId;
        await this.publishResult(replyTo, {
            traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: { profiles: this.profileManager.list(actualOwner) },
            done: true,
        });
    }

    private async handleProfileCreate(
        data: Record<string, unknown>,
        userId: string,
        replyTo: string,
        traceId: string,
    ): Promise<void> {
        const name = data['name'] as string;
        if (!name) {
            await this.publishError(replyTo, traceId, 'Missing required field: "name"');
            return;
        }
        const result = this.profileManager.create({
            name,
            shell: data['shell'] as string | undefined,
            args: data['args'] as string[] | undefined,
            cwd: data['cwd'] as string | undefined,
            env: data['env'] as Record<string, string> | undefined,
            startupCommands: data['startupCommands'] as string[] | undefined,
            owner: userId,
            isDefault: data['isDefault'] as boolean | undefined,
        });
        await this.publishResult(replyTo, {
            traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: result,
            done: true,
        });
    }

    private async handleProfileUpdate(
        data: Record<string, unknown>,
        userId: string,
        roles: string[],
        replyTo: string,
        traceId: string,
    ): Promise<void> {
        const id = data['id'] as string;
        if (!id) {
            await this.publishError(replyTo, traceId, 'Missing required field: "id"');
            return;
        }
        const existing = this.profileManager.get(id);
        if (!existing) {
            await this.publishError(replyTo, traceId, `Profile not found: ${id}`);
            return;
        }
        if (existing.owner !== userId && !roles.includes('admin')) {
            await this.publishError(replyTo, traceId, 'Not profile owner');
            return;
        }
        const updated = this.profileManager.update(id, {
            name: data['name'] as string | undefined,
            shell: data['shell'] as string | undefined,
            args: data['args'] as string[] | undefined,
            cwd: data['cwd'] as string | undefined,
            env: data['env'] as Record<string, string> | undefined,
            startupCommands: data['startupCommands'] as string[] | undefined,
            isDefault: data['isDefault'] as boolean | undefined,
        });
        await this.publishResult(replyTo, {
            traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: updated,
            done: true,
        });
    }

    private async handleProfileDelete(
        data: Record<string, unknown>,
        userId: string,
        roles: string[],
        replyTo: string,
        traceId: string,
    ): Promise<void> {
        const id = data['id'] as string;
        if (!id) {
            await this.publishError(replyTo, traceId, 'Missing required field: "id"');
            return;
        }
        const existing = this.profileManager.get(id);
        if (!existing) {
            await this.publishError(replyTo, traceId, `Profile not found: ${id}`);
            return;
        }
        if (existing.owner !== userId && !roles.includes('admin')) {
            await this.publishError(replyTo, traceId, 'Not profile owner');
            return;
        }
        this.profileManager.delete(id);
        await this.publishResult(replyTo, {
            traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: { ok: true, id },
            done: true,
        });
    }
}
