/**
 * WebSocket topic handler for `terminal.*` actions.
 *
 * Maps incoming WebSocket requests to TerminalManager, TerminalProfileManager,
 * and SessionLogger methods. Supports real-time PTY streaming.
 */

import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { HandlerContext } from '@orch/daemon';
import type { TerminalManager } from './manager.js';
import type { TerminalProfileManager } from './profiles.js';
import type { SessionLogger } from './logger.js';
import type { TerminalSessionStore } from './sessions.js';
import {
    checkAccess,
    validateShell,
    validateInput,
    type TerminalPolicy,
    DEFAULT_TERMINAL_POLICY,
} from './permissions.js';

// ─── Handler Factory ────────────────────────────────────────────────────────

export function createTerminalHandler(
    manager: TerminalManager,
    profileManager: TerminalProfileManager,
    sessionLogger: SessionLogger,
    sessionStore?: TerminalSessionStore,
    policy: TerminalPolicy = DEFAULT_TERMINAL_POLICY,
) {
    return async (action: string, payload: unknown, context: HandlerContext): Promise<unknown> => {
        const data = (payload ?? {}) as Record<string, unknown>;
        const identity = context.identity ?? 'anonymous';
        const roles = context.roles ?? [];

        switch (action) {
            // ── Session actions ──────────────────────────────────────────

            case 'spawn': {
                // Permission check
                const sessionCount = manager.countByOwner(identity);
                const access = checkAccess(identity, roles, sessionCount, policy);
                if (!access.allowed) {
                    throw new OrchestratorError(
                        ErrorCode.PERMISSION_DENIED,
                        access.reason ?? 'Terminal access denied',
                    );
                }

                const shell = (data['shell'] as string) || undefined;
                if (shell) {
                    const shellCheck = validateShell(shell, policy);
                    if (!shellCheck.allowed) {
                        throw new OrchestratorError(
                            ErrorCode.PERMISSION_DENIED,
                            shellCheck.reason ?? 'Shell not allowed',
                        );
                    }
                }

                const sessionId = (data['sessionId'] as string) ||
                    `term_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

                const info = manager.spawn({
                    sessionId,
                    shell,
                    args: data['args'] as string[] | undefined,
                    cwd: data['cwd'] as string | undefined,
                    env: data['env'] as Record<string, string> | undefined,
                    cols: data['cols'] as number | undefined,
                    rows: data['rows'] as number | undefined,
                    owner: identity,
                    profileId: data['profileId'] as string | undefined,
                });

                // Start recording (with DB metadata)
                sessionLogger.startRecording({
                    sessionId,
                    owner: info.owner,
                    shell: info.shell,
                    cwd: info.cwd,
                    cols: info.cols,
                    rows: info.rows,
                    profileId: info.profileId,
                });

                // Wire PTY output → WebSocket stream
                const dataHandler = (_sid: string, output: string) => {
                    if (_sid === sessionId && context.emit) {
                        sessionLogger.appendData(sessionId, output);
                        context.emit('stream', { sessionId, data: output });
                    }
                };
                const exitHandler = (_sid: string, exitCode: number, signal?: number) => {
                    if (_sid === sessionId && context.emit) {
                        sessionLogger.stopRecording(sessionId, exitCode);
                        context.emit('stream', { sessionId, type: 'exit', exitCode, signal });
                        // Clean up listeners
                        manager.removeListener('data', dataHandler);
                        manager.removeListener('exit', exitHandler);
                    }
                };

                manager.on('data', dataHandler);
                manager.on('exit', exitHandler);

                return info;
            }

            case 'write': {
                const sessionId = requireString(data, 'sessionId');
                const input = data['data'] as string ?? '';
                const session = manager.get(sessionId);
                if (!session) {
                    throw new OrchestratorError(ErrorCode.NOT_FOUND, `Session not found: ${sessionId}`);
                }
                if (session.owner !== identity && !roles.includes('admin')) {
                    throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, 'Not session owner');
                }

                const inputCheck = validateInput(input, policy);
                if (!inputCheck.allowed) {
                    throw new OrchestratorError(
                        ErrorCode.PERMISSION_DENIED,
                        inputCheck.reason ?? 'Input blocked by policy',
                    );
                }

                manager.write(sessionId, input);
                return { ok: true };
            }

            case 'resize': {
                const sessionId = requireString(data, 'sessionId');
                const cols = data['cols'] as number ?? 80;
                const rows = data['rows'] as number ?? 24;
                const session = manager.get(sessionId);
                if (!session) {
                    throw new OrchestratorError(ErrorCode.NOT_FOUND, `Session not found: ${sessionId}`);
                }
                if (session.owner !== identity && !roles.includes('admin')) {
                    throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, 'Not session owner');
                }
                manager.resize(sessionId, cols, rows);
                return { ok: true, cols, rows };
            }

            case 'kill': {
                const sessionId = requireString(data, 'sessionId');
                const session = manager.get(sessionId);
                if (!session) {
                    throw new OrchestratorError(ErrorCode.NOT_FOUND, `Session not found: ${sessionId}`);
                }
                if (session.owner !== identity && !roles.includes('admin')) {
                    throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, 'Not session owner');
                }
                sessionLogger.stopRecording(sessionId, undefined);
                manager.kill(sessionId);
                return { ok: true, sessionId };
            }

            // ── Session history actions ─────────────────────────────────

            case 'session.list': {
                if (!sessionStore) return { sessions: [] };
                const owner = roles.includes('admin')
                    ? (data['owner'] as string | undefined)
                    : identity;
                const limitRaw = (data['limit'] as number | undefined) ?? 100;
                const limit = Number.isFinite(limitRaw)
                    ? Math.max(1, Math.min(500, Math.floor(limitRaw)))
                    : 100;
                return { sessions: sessionStore.list(owner, limit) };
            }

            case 'session.get': {
                if (!sessionStore) throw new OrchestratorError(ErrorCode.NOT_FOUND, 'Session store not available');
                const sessionId = requireString(data, 'sessionId');
                const record = sessionStore.get(sessionId);
                if (!record) {
                    throw new OrchestratorError(ErrorCode.NOT_FOUND, `Session record not found: ${sessionId}`);
                }
                if (record.owner !== identity && !roles.includes('admin')) {
                    throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, 'Not session owner');
                }
                return record;
            }

            case 'session.logs': {
                const sessionId = requireString(data, 'sessionId');
                // Check ownership via live sessions first, then DB records
                const live = manager.get(sessionId);
                if (live && live.owner !== identity && !roles.includes('admin')) {
                    throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, 'Not session owner');
                }
                if (!live) {
                    if (!sessionStore) {
                        throw new OrchestratorError(
                            ErrorCode.NOT_FOUND,
                            `Session not found: ${sessionId}`,
                        );
                    }
                    const record = sessionStore.get(sessionId);
                    if (!record) {
                        throw new OrchestratorError(ErrorCode.NOT_FOUND, `Session not found: ${sessionId}`);
                    }
                    if (record.owner !== identity && !roles.includes('admin')) {
                        throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, 'Not session owner');
                    }
                }
                const content = sessionLogger.getLogContent(sessionId);
                return { sessionId, content: content ?? '' };
            }

            case 'list': {
                // Admins see all, others see only own sessions
                const sessions = manager.list();
                const filtered = roles.includes('admin')
                    ? sessions
                    : sessions.filter((s) => s.owner === identity);
                return { sessions: filtered };
            }

            case 'scrollback': {
                const sessionId = requireString(data, 'sessionId');
                const lines = data['lines'] as number | undefined;
                const session = manager.get(sessionId);
                if (!session) {
                    throw new OrchestratorError(ErrorCode.NOT_FOUND, `Session not found: ${sessionId}`);
                }
                if (session.owner !== identity && !roles.includes('admin')) {
                    throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, 'Not session owner');
                }
                return { sessionId, content: sessionLogger.getScrollback(sessionId, lines) };
            }

            // ── Profile actions ─────────────────────────────────────────

            case 'profile.list': {
                const owner = (data['owner'] as string) || identity;
                // Non-admins can only see their own profiles
                const actualOwner = roles.includes('admin') ? owner : identity;
                return { profiles: profileManager.list(actualOwner) };
            }

            case 'profile.create': {
                const name = requireString(data, 'name');
                return profileManager.create({
                    name,
                    shell: data['shell'] as string | undefined,
                    args: data['args'] as string[] | undefined,
                    cwd: data['cwd'] as string | undefined,
                    env: data['env'] as Record<string, string> | undefined,
                    startupCommands: data['startupCommands'] as string[] | undefined,
                    owner: identity,
                    isDefault: data['isDefault'] as boolean | undefined,
                });
            }

            case 'profile.update': {
                const id = requireString(data, 'id');
                const existing = profileManager.get(id);
                if (!existing) {
                    throw new OrchestratorError(ErrorCode.NOT_FOUND, `Profile not found: ${id}`);
                }
                if (existing.owner !== identity && !roles.includes('admin')) {
                    throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, 'Not profile owner');
                }
                const updated = profileManager.update(id, {
                    name: data['name'] as string | undefined,
                    shell: data['shell'] as string | undefined,
                    args: data['args'] as string[] | undefined,
                    cwd: data['cwd'] as string | undefined,
                    env: data['env'] as Record<string, string> | undefined,
                    startupCommands: data['startupCommands'] as string[] | undefined,
                    isDefault: data['isDefault'] as boolean | undefined,
                });
                return updated;
            }

            case 'profile.delete': {
                const id = requireString(data, 'id');
                const existing = profileManager.get(id);
                if (!existing) {
                    throw new OrchestratorError(ErrorCode.NOT_FOUND, `Profile not found: ${id}`);
                }
                if (existing.owner !== identity && !roles.includes('admin')) {
                    throw new OrchestratorError(ErrorCode.PERMISSION_DENIED, 'Not profile owner');
                }
                profileManager.delete(id);
                return { ok: true, id };
            }

            default:
                throw new OrchestratorError(
                    ErrorCode.UNKNOWN_ACTION,
                    `Unknown terminal action: "${action}"`,
                    {
                        action,
                        availableActions: [
                            'spawn', 'write', 'resize', 'kill', 'list', 'scrollback',
                            'profile.list', 'profile.create', 'profile.update', 'profile.delete',
                            'session.list', 'session.get', 'session.logs',
                        ],
                    },
                );
        }
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requireString(data: Record<string, unknown>, field: string): string {
    const value = data[field];
    if (typeof value !== 'string' || value.length === 0) {
        throw new OrchestratorError(
            ErrorCode.VALIDATION_ERROR,
            `Missing required field: "${field}"`,
            { field },
        );
    }
    return value;
}
