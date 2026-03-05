import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import { TerminalManager } from './manager.js';

interface MockPty extends EventEmitter {
    pid: number;
    write: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    kill: () => void;
    onData: (cb: (data: string) => void) => void;
    onExit: (cb: (ev: { exitCode: number; signal?: number }) => void) => void;
}

const createdPtys: MockPty[] = [];

vi.mock('node-pty', () => {
    // track failures for special test cases
    const posixCounter: { [key: string]: number } = {};
    return {
        spawn: vi.fn((shell: string, args: string[], options: any) => {
            // simulate failure for certain cwd to exercise error handling
            if (options.env?.['OWNER_FOR_TEST'] === 'throw') {
                throw new Error('simulated spawn failure');
            }

            // simulate a posix_spawnp permissions error on first attempt only
            if (options.env?.['OWNER_FOR_TEST'] === 'posix') {
                const count = posixCounter['count'] || 0;
                posixCounter['count'] = count + 1;
                if (count === 0) {
                    throw new Error('posix_spawnp failed.');
                }
            }

            const pty = new EventEmitter() as MockPty;
            pty.pid = Math.floor(Math.random() * 10_000);

            let onDataCb: ((data: string) => void) | undefined;
            let onExitCb: ((ev: { exitCode: number; signal?: number }) => void) | undefined;

            pty.onData = (cb) => {
                onDataCb = cb;
            };
            pty.onExit = (cb) => {
                onExitCb = cb;
            };

            pty.write = vi.fn();
            pty.resize = vi.fn();
            pty.kill = vi.fn(() => {
                onExitCb?.({ exitCode: 0 });
            });

            pty.emit('mock:data', 'ready');
            pty.on('mock:data', (chunk: string) => onDataCb?.(chunk));
            pty.on('mock:exit', (code: number) => onExitCb?.({ exitCode: code }));

            createdPtys.push(pty);
            return pty;
        }),
    };
});

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

describe('TerminalManager', () => {
    beforeEach(() => {
        createdPtys.splice(0, createdPtys.length);
        process.env.HOME = process.cwd();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('spawns a session and lists it', () => {
        const manager = new TerminalManager(createLoggerStub());
        const info = manager.spawn({
            sessionId: 's1',
            owner: 'alice',
            cols: 120,
            rows: 40,
            cwd: '/tmp',
        });

        expect(info.sessionId).toBe('s1');
        expect(info.owner).toBe('alice');
        expect(manager.list()).toHaveLength(1);
        expect(manager.get('s1')?.cols).toBe(120);
    });

    it('defaults to HOME when cwd is an empty string', () => {
        const manager = new TerminalManager(createLoggerStub());
        process.env.HOME = process.cwd();
        const info = manager.spawn({
            sessionId: 's-empty',
            owner: 'eve',
            cwd: '',
        });
        expect(info.cwd).toBe(process.cwd());
    });

    it('throws when provided working directory does not exist', () => {
        const manager = new TerminalManager(createLoggerStub());
        const badPath = '/definitely-does-not-exist-' + Date.now();
        
        expect(() =>
            manager.spawn({ sessionId: 's-bad', owner: 'frank', cwd: badPath }),
        ).toThrow(/Invalid working directory/);
    });

    it('converts underlying pty errors into readable messages', () => {
        const manager = new TerminalManager(createLoggerStub());
        expect(() =>
            manager.spawn({ sessionId: 's-throw', owner: 'gary', cwd: process.cwd(), env: { OWNER_FOR_TEST: 'throw' } }),
        ).toThrow(/Failed to spawn terminal/);
    });

    it('attempts to repair node-pty permissions on posix_spawnp failures', () => {
        const logger = createLoggerStub();
        const manager = new TerminalManager(logger);

        const info = manager.spawn({ sessionId: 's-posix', owner: 'helen', cwd: process.cwd(), env: { OWNER_FOR_TEST: 'posix' } });
        // should succeed after a single retry
        expect(info.sessionId).toBe('s-posix');
        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ sessionId: 's-posix' }),
            expect.stringContaining('posix_spawnp failed'),
        );
    });

    it('writes and resizes active sessions', () => {
        const manager = new TerminalManager(createLoggerStub());
        manager.spawn({ sessionId: 's2', owner: 'bob' });

        manager.write('s2', 'echo hi\n');
        manager.resize('s2', 100, 35);

        const pty = createdPtys[0]!;
        expect(pty.write).toHaveBeenCalledWith('echo hi\n');
        expect(pty.resize).toHaveBeenCalledWith(100, 35);
        expect(manager.get('s2')?.cols).toBe(100);
        expect(manager.get('s2')?.rows).toBe(35);
    });

    it('emits data/exit and removes session on exit', () => {
        const manager = new TerminalManager(createLoggerStub());
        manager.spawn({ sessionId: 's3', owner: 'carol' });

        const dataSpy = vi.fn();
        const exitSpy = vi.fn();
        manager.on('data', dataSpy);
        manager.on('exit', exitSpy);

        const pty = createdPtys[0]!;
        pty.emit('mock:data', 'hello');
        pty.emit('mock:exit', 7);

        expect(dataSpy).toHaveBeenCalledWith('s3', 'hello');
        expect(exitSpy).toHaveBeenCalledWith('s3', 7, undefined);
        expect(manager.get('s3')).toBeUndefined();
    });

    it('kills sessions and shutdownAll cleans remaining sessions', () => {
        const manager = new TerminalManager(createLoggerStub());
        manager.spawn({ sessionId: 's4', owner: 'dave' });
        manager.spawn({ sessionId: 's5', owner: 'dave' });

        manager.kill('s4');
        expect(manager.get('s4')).toBeUndefined();

        manager.shutdownAll();
        expect(manager.list()).toHaveLength(0);
    });
});
