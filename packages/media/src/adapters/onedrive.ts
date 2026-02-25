import type { MediaFile } from './local.js';

export class OneDriveAdapter {
    constructor(private readonly accessToken: string) {}

    async listFiles(folderId: string = 'root'): Promise<MediaFile[]> {
        const url = folderId === 'root' 
            ? 'https://graph.microsoft.com/v1.0/me/drive/root/children'
            : `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children`;

        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${this.accessToken}`
            }
        });

        if (!response.ok) {
            throw new Error(`OneDrive API error: ${response.statusText}`);
        }

        const data = await response.json() as { value?: Array<any> };
        
        return (data.value ?? []).map((file: any) => ({
            id: `onedrive:${file.id}`,
            name: file.name,
            path: file.id,
            type: file.folder ? 'directory' : 'file',
            size: file.size,
            mimeType: file.file?.mimeType,
            source: 'onedrive',
            updatedAt: file.lastModifiedDateTime
        }));
    }
}
