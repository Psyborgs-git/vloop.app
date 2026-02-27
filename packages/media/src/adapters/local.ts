import { mkdir, readdir, stat } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';

export interface MediaFile {
    id: string;
    name: string;
    path: string;
    type: 'file' | 'directory';
    size?: number;
    mimeType?: string;
    source: 'local' | 'google-drive' | 'onedrive';
    updatedAt: string;
}

export class LocalMediaAdapter {
    constructor(private readonly rootPath: string) {}

    private validatePath(subPath: string): string {
        const targetPath = resolve(this.rootPath, subPath);
        const resolvedRoot = resolve(this.rootPath);

        // Ensure the path is within the root directory
        // We add a path separator to the end of the root path to prevent partial matches
        // e.g. /var/www vs /var/www-secret
        if (targetPath !== resolvedRoot && !targetPath.startsWith(resolvedRoot + sep)) {
            throw new Error('Access denied: Path traversal detected');
        }
        return targetPath;
    }

    async createDirectory(subPath: string): Promise<void> {
        const targetPath = this.validatePath(subPath);
        await mkdir(targetPath, { recursive: true });
    }

    async listFiles(subPath: string = ''): Promise<MediaFile[]> {
        const targetPath = this.validatePath(subPath);

        const entries = await readdir(targetPath, { withFileTypes: true });
        
        const files: MediaFile[] = [];
        for (const entry of entries) {
            const fullPath = join(targetPath, entry.name);
            const relativePath = join(subPath, entry.name);
            const stats = await stat(fullPath);
            
            files.push({
                id: `local:${Buffer.from(relativePath).toString('base64')}`,
                name: entry.name,
                path: relativePath,
                type: entry.isDirectory() ? 'directory' : 'file',
                size: stats.size,
                mimeType: entry.isDirectory() ? undefined : this.guessMimeType(entry.name),
                source: 'local',
                updatedAt: stats.mtime.toISOString()
            });
        }
        
        return files;
    }

    private guessMimeType(filename: string): string {
        const ext = extname(filename).toLowerCase();
        const map: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.pdf': 'application/pdf',
            '.txt': 'text/plain',
            '.md': 'text/markdown',
            '.mp4': 'video/mp4',
            '.mp3': 'audio/mpeg'
        };
        return map[ext] || 'application/octet-stream';
    }
}
