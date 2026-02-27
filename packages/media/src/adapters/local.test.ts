import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalMediaAdapter } from './local.js';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('LocalMediaAdapter Security', () => {
    let tempDir: string;
    let adapter: LocalMediaAdapter;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'orch-media-test-'));
        adapter = new LocalMediaAdapter(tempDir);
        // Create a dummy file in the root
        await writeFile(join(tempDir, 'root.txt'), 'content');
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it('should throw error when accessing parent directory via traversal', async () => {
        // Attempt to access parent directory of tempDir
        await expect(adapter.listFiles('..')).rejects.toThrow('Access denied: Path traversal detected');
    });

    it('should throw error for complex traversal attempts', async () => {
        await expect(adapter.listFiles('foo/../../bar')).rejects.toThrow('Access denied: Path traversal detected');
    });

    it('should throw error for sibling directory traversal', async () => {
        // This simulates an attack where /root_dir + _secret is tried
        // If the check is `startsWith('/root_dir')`, then `/root_dir_secret` passes.
        // It must check `startsWith('/root_dir/')`.
        // We create a sibling directory to our tempDir to simulate this.
        const siblingDir = tempDir + '_secret';
        try {
            await mkdir(siblingDir);
            await writeFile(join(siblingDir, 'secret.txt'), 'secret');

            // Try to access the sibling via `../orch-media-test-XXXXX_secret`
            // We need to construct the relative path from tempDir to siblingDir
            const relativeToSibling = '../' + siblingDir.split('/').pop();

            await expect(adapter.listFiles(relativeToSibling)).rejects.toThrow('Access denied: Path traversal detected');
        } finally {
            // cleanup sibling
            await rm(siblingDir, { recursive: true, force: true }).catch(() => {});
        }
    });

    it('should allow listing files in subdirectories', async () => {
        const subDir = join(tempDir, 'subdir');
        await mkdir(subDir);
        await writeFile(join(subDir, 'file.txt'), 'content');

        const files = await adapter.listFiles('subdir');
        expect(files).toHaveLength(1);
        expect(files[0].name).toBe('file.txt');
    });

    it('should throw error if directory does not exist', async () => {
        // Standard readdir behavior is to throw ENOENT
        await expect(adapter.listFiles('non-existent')).rejects.toThrow();
    });

    it('should allow creating a valid subdirectory', async () => {
        await adapter.createDirectory('new-subdir');
        const stats = await import('node:fs/promises').then(fs => fs.stat(join(tempDir, 'new-subdir')));
        expect(stats.isDirectory()).toBe(true);
    });

    it('should throw error when creating directory via traversal', async () => {
        await expect(adapter.createDirectory('../outside')).rejects.toThrow('Access denied: Path traversal detected');
    });
});
