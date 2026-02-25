import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { ErrorCode, OrchestratorError } from '@orch/shared';
import { createTerminalHandler } from './handler.js';

function context(identity = 'alice', roles: string[] = []) {
    return {
        identity,
        roles,
        emit: vi.fn(),
    } as any;
}

class FakeManager extends EventEmitter {
    public get = vi.fn();
    public list = vi.fn(() => []);
    public countByOwner = vi.fn(() => 0);
    public spawn = vi.fn();
    public write = vi.fn();
    public resize = vi.fn();
    public kill = vi.fn();
}

describe('terminal handler session history actions', () => {
    it('session.logs rejects unknown session when store is not configured', async () => {
        const manager = new FakeManager();
        manager.get.mockReturnValue(undefined);

        const profileManager = {
            list: vi.fn(() => []),
            create: vi.fn(),
            get: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
        } as any;

        const sessionLogger = {
            startRecording: vi.fn(),
            appendData: vi.fn(),
            stopRecording: vi.fn(),
            getScrollback: vi.fn(() => ''),
            getLogContent: vi.fn(() => 'secret-log'),
        } as any;

        const handler = createTerminalHandler(manager as any, profileManager, sessionLogger);

        await expect(handler('session.logs', { sessionId: 's1' }, context())).rejects.toMatchObject({
            code: ErrorCode.NOT_FOUND,
        } satisfies Partial<OrchestratorError>);
    });

    it('session.logs enforces ownership from session store records', async () => {
        const manager = new FakeManager();
        manager.get.mockReturnValue(undefined);

        const profileManager = {
            list: vi.fn(() => []),
            create: vi.fn(),
            get: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
        } as any;

        const sessionLogger = {
            startRecording: vi.fn(),
            appendData: vi.fn(),
            stopRecording: vi.fn(),
            getScrollback: vi.fn(() => ''),
            getLogContent: vi.fn(() => 'secret-log'),
        } as any;

        const sessionStore = {
            list: vi.fn(() => []),
            get: vi.fn(() => ({ id: 's2', owner: 'bob' })),
        } as any;

        const handler = createTerminalHandler(manager as any, profileManager, sessionLogger, sessionStore);

        await expect(handler('session.logs', { sessionId: 's2' }, context('alice', []))).rejects.toMatchObject({
            code: ErrorCode.PERMISSION_DENIED,
        } satisfies Partial<OrchestratorError>);
    });

    it('session.list clamps limit into safe bounds', async () => {
        const manager = new FakeManager();

        const profileManager = {
            list: vi.fn(() => []),
            create: vi.fn(),
            get: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
        } as any;

        const sessionLogger = {
            startRecording: vi.fn(),
            appendData: vi.fn(),
            stopRecording: vi.fn(),
            getScrollback: vi.fn(() => ''),
            getLogContent: vi.fn(() => ''),
        } as any;

        const sessionStore = {
            list: vi.fn(() => []),
            get: vi.fn(),
        } as any;

        const handler = createTerminalHandler(manager as any, profileManager, sessionLogger, sessionStore);
        await handler('session.list', { limit: 10000 }, context('alice', ['admin']));

        expect(sessionStore.list).toHaveBeenCalledWith(undefined, 500);
    });
});
