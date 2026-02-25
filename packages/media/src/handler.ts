import type { HandlerContext } from '@orch/daemon';
import { LocalMediaAdapter } from './adapters/local.js';
import { GoogleDriveAdapter } from './adapters/google-drive.js';
import { OneDriveAdapter } from './adapters/onedrive.js';

export function createMediaHandler(localRootPath: string) {
    const localAdapter = new LocalMediaAdapter(localRootPath);

    return async (action: string, payload: any, _context: HandlerContext) => {
        switch (action) {
            case 'list': {
                const { source, path, accessToken } = payload;
                
                if (source === 'local') {
                    return await localAdapter.listFiles(path);
                } else if (source === 'google-drive') {
                    if (!accessToken) throw new Error('Access token required for Google Drive');
                    const adapter = new GoogleDriveAdapter(accessToken);
                    return await adapter.listFiles(path);
                } else if (source === 'onedrive') {
                    if (!accessToken) throw new Error('Access token required for OneDrive');
                    const adapter = new OneDriveAdapter(accessToken);
                    return await adapter.listFiles(path);
                }
                
                throw new Error(`Unknown media source: ${source}`);
            }
            default:
                throw new Error(`Unknown media action: ${action}`);
        }
    };
}
