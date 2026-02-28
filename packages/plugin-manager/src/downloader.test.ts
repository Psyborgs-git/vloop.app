import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
import JSZip from 'jszip';
import { PluginDownloader } from './downloader.js';
import type { Logger } from '@orch/daemon';

// simple logger stub that satisfies the interface
const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
} as unknown as Logger;

describe('PluginDownloader', () => {
    const tempDir = './test-data/plugins-downloader';
    const zipPath = join(process.cwd(), 'test-plugin.zip');
    const manifest = { id: 'foo', name: 'foo plugin', version: '0.1.0', entrypoint: 'x' };
    let downloader: PluginDownloader;

    beforeEach(async () => {
        downloader = new PluginDownloader(tempDir, mockLogger);
        // create a simple zip file used by tests
        const zip = new JSZip();
        zip.file('plugin.json', JSON.stringify(manifest));
        const buffer = await zip.generateAsync({ type: 'nodebuffer' });
        writeFileSync(zipPath, buffer);
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
        try {
            rmSync(zipPath);
        } catch {}
    });

    it('loads plugin from plain filesystem path', async () => {
        const result = await downloader.download(zipPath);
        expect(result.manifest.id).toBe(manifest.id);
    });

    it('loads plugin when given file:// URL (two slashes)', async () => {
        const url = `file://${zipPath}`;
        const result = await downloader.download(url);
        expect(result.manifest.id).toBe(manifest.id);
    });

    it('loads plugin when given file:/ URL (single slash)', async () => {
        const url = `file:${zipPath}`; // some clients emit this form
        const result = await downloader.download(url);
        expect(result.manifest.id).toBe(manifest.id);
    });

    it('strips accidental cwd prefix before file URL', async () => {
        // simulate what was seen in the issue: the cwd gets prepended to a
        // file:/ URL, then resolve() would treat it as relative.
        const bad = `${process.cwd()}/file:${zipPath}`;
        const result = await downloader.download(bad);
        expect(result.manifest.id).toBe(manifest.id);
    });
});
