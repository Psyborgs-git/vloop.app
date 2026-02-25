import type { MediaFile } from './local.js';

export class GoogleDriveAdapter {
    constructor(private readonly accessToken: string) {}

    async listFiles(folderId: string = 'root'): Promise<MediaFile[]> {
        const response = await fetch(`https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&fields=files(id,name,mimeType,size,modifiedTime)`, {
            headers: {
                Authorization: `Bearer ${this.accessToken}`
            }
        });

        if (!response.ok) {
            throw new Error(`Google Drive API error: ${response.statusText}`);
        }

        const data = await response.json() as { files?: Array<any> };
        
        return (data.files ?? []).map((file: any) => ({
            id: `gdrive:${file.id}`,
            name: file.name,
            path: file.id,
            type: file.mimeType === 'application/vnd.google-apps.folder' ? 'directory' : 'file',
            size: file.size ? parseInt(file.size, 10) : undefined,
            mimeType: file.mimeType,
            source: 'google-drive',
            updatedAt: file.modifiedTime
        }));
    }
}
