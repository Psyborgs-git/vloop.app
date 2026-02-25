import { mkdir, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

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

    async listFiles(subPath: string = ''): Promise<MediaFile[]> {
        const targetPath = join(this.rootPath, subPath);
        await mkdir(targetPath, { recursive: true });
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
