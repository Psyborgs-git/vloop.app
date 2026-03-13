/**
 * Filesystem Service Worker — event-driven file operations.
 *
 * Subscribes to `fs:ops` Redis channel and provides sandboxed filesystem
 * operations: read, write, list, stat, mkdir, remove.
 *
 * All operations are scoped to a configurable root directory for security.
 */

import {
    ServiceWorker,
    CHANNELS,
} from '@orch/event-contracts';
import type { ServiceCommand, RedisLike } from '@orch/event-contracts';
import { readFile, writeFile, readdir, stat, mkdir, rm } from 'node:fs/promises';
import { resolve, relative, normalize } from 'node:path';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FsServiceConfig {
    redis: { subscriber: RedisLike; publisher: RedisLike; store: RedisLike };
    /** Root directory that all operations are scoped to. */
    rootDir: string;
    /** Maximum file size in bytes for read/write (default: 10MB). */
    maxFileSize?: number;
}

// ─── Service Worker ─────────────────────────────────────────────────────────

export class FsServiceWorker extends ServiceWorker {
    private rootDir: string;
    private maxFileSize: number;

    constructor(config: FsServiceConfig) {
        super(
            {
                serviceName: 'fs',
                commandChannel: CHANNELS.FS_OPS,
            },
            config.redis,
        );
        this.rootDir = resolve(config.rootDir);
        this.maxFileSize = config.maxFileSize ?? 10 * 1024 * 1024;
    }

    protected async handleCommand(command: ServiceCommand): Promise<void> {
        const { action, payload, replyTo, traceId } = command;
        const data = (payload ?? {}) as Record<string, unknown>;

        switch (action) {
            case 'read':
                return this.handleRead(data, replyTo, traceId);
            case 'write':
                return this.handleWrite(data, replyTo, traceId);
            case 'list':
                return this.handleList(data, replyTo, traceId);
            case 'stat':
                return this.handleStat(data, replyTo, traceId);
            case 'mkdir':
                return this.handleMkdir(data, replyTo, traceId);
            case 'remove':
                return this.handleRemove(data, replyTo, traceId);
            default:
                await this.publishError(replyTo, traceId, `Unknown fs action: "${action}"`);
        }
    }

    // ── Path security ───────────────────────────────────────────────────

    private safePath(requestedPath: string): string {
        const resolved = resolve(this.rootDir, normalize(requestedPath));
        const rel = relative(this.rootDir, resolved);
        if (rel.startsWith('..') || resolve(this.rootDir, rel) !== resolved) {
            throw new Error(`Path traversal blocked: ${requestedPath}`);
        }
        return resolved;
    }

    // ── Action handlers ─────────────────────────────────────────────────

    private async handleRead(
        data: Record<string, unknown>,
        replyTo: string,
        traceId: string,
    ): Promise<void> {
        const path = data['path'] as string;
        if (!path) {
            await this.publishError(replyTo, traceId, 'Missing required field: "path"');
            return;
        }
        const safePath = this.safePath(path);
        const encoding = (data['encoding'] as BufferEncoding) ?? 'utf-8';
        const content = await readFile(safePath, { encoding });
        if (typeof content === 'string' && content.length > this.maxFileSize) {
            await this.publishError(replyTo, traceId, `File too large: ${content.length} bytes`);
            return;
        }
        await this.publishResult(replyTo, {
            traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: { path, content },
            done: true,
        });
    }

    private async handleWrite(
        data: Record<string, unknown>,
        replyTo: string,
        traceId: string,
    ): Promise<void> {
        const path = data['path'] as string;
        const content = data['content'] as string;
        if (!path) {
            await this.publishError(replyTo, traceId, 'Missing required field: "path"');
            return;
        }
        if (content === undefined || content === null) {
            await this.publishError(replyTo, traceId, 'Missing required field: "content"');
            return;
        }
        const safePath = this.safePath(path);
        const encoding = (data['encoding'] as BufferEncoding) ?? 'utf-8';
        await writeFile(safePath, content, { encoding });
        await this.publishResult(replyTo, {
            traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: { ok: true, path },
            done: true,
        });
    }

    private async handleList(
        data: Record<string, unknown>,
        replyTo: string,
        traceId: string,
    ): Promise<void> {
        const path = (data['path'] as string) ?? '.';
        const safePath = this.safePath(path);
        const entries = await readdir(safePath, { withFileTypes: true });
        const items = entries.map((e) => ({
            name: e.name,
            type: e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'other',
        }));
        await this.publishResult(replyTo, {
            traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: { path, entries: items },
            done: true,
        });
    }

    private async handleStat(
        data: Record<string, unknown>,
        replyTo: string,
        traceId: string,
    ): Promise<void> {
        const path = data['path'] as string;
        if (!path) {
            await this.publishError(replyTo, traceId, 'Missing required field: "path"');
            return;
        }
        const safePath = this.safePath(path);
        const stats = await stat(safePath);
        await this.publishResult(replyTo, {
            traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: {
                path,
                size: stats.size,
                isFile: stats.isFile(),
                isDirectory: stats.isDirectory(),
                modified: stats.mtime.toISOString(),
                created: stats.birthtime.toISOString(),
            },
            done: true,
        });
    }

    private async handleMkdir(
        data: Record<string, unknown>,
        replyTo: string,
        traceId: string,
    ): Promise<void> {
        const path = data['path'] as string;
        if (!path) {
            await this.publishError(replyTo, traceId, 'Missing required field: "path"');
            return;
        }
        const safePath = this.safePath(path);
        await mkdir(safePath, { recursive: true });
        await this.publishResult(replyTo, {
            traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: { ok: true, path },
            done: true,
        });
    }

    private async handleRemove(
        data: Record<string, unknown>,
        replyTo: string,
        traceId: string,
    ): Promise<void> {
        const path = data['path'] as string;
        if (!path) {
            await this.publishError(replyTo, traceId, 'Missing required field: "path"');
            return;
        }
        const safePath = this.safePath(path);
        const recursive = data['recursive'] === true;
        await rm(safePath, { recursive, force: false });
        await this.publishResult(replyTo, {
            traceId,
            timestamp: new Date().toISOString(),
            status: 'ok',
            payload: { ok: true, path },
            done: true,
        });
    }
}
