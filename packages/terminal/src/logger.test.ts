import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionLogger } from './logger.js';

function createLoggerStub() {
    const base = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    };
    return {
        ...base,
        child: vi.fn(() => base),
    } as any;
}

describe('SessionLogger store integration', () => {
    it('creates and closes session records via TerminalSessionStore', () => {
        const sessionStore = {
            create: vi.fn(),
            end: vi.fn(),
        } as any;

        const logDir = mkdtempSync(join(tmpdir(), 'terminal-logs-'));
        const logger = new SessionLogger({
            logDir,
            logger: createLoggerStub(),
            persistToDisk: false,
            sessionStore,
        });

        logger.startRecording({
            sessionId: 's1',
            owner: 'alice',
            shell: '/bin/zsh',
            cwd: '/tmp',
            cols: 80,
            rows: 24,
            profileId: 'p1',
        });

        logger.stopRecording('s1', 0);

        expect(sessionStore.create).toHaveBeenCalledWith(expect.objectContaining({
            id: 's1',
            owner: 'alice',
            shell: '/bin/zsh',
            cwd: '/tmp',
            cols: 80,
            rows: 24,
            profileId: 'p1',
        }));
        expect(sessionStore.end).toHaveBeenCalledWith('s1', 0);
    });
});
