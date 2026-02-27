import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import JSZip from 'jszip';
import { OrchestratorError, ErrorCode } from '@orch/shared';
import type { Logger } from '@orch/daemon';
import { PluginManifestSchema } from './manifest.js';
import type { PluginManifest } from './manifest.js';

export class PluginDownloader {
    constructor(
        private readonly pluginsDir: string,
        private readonly logger: Logger
    ) {
        if (!existsSync(pluginsDir)) {
            mkdirSync(pluginsDir, { recursive: true });
        }
    }

    /**
     * Downloads and extracts a plugin from a URL or local path.
     * Returns the parsed manifest and the path to the extracted directory.
     */
    public async download(urlOrPath: string): Promise<{ manifest: PluginManifest; dir: string }> {
        let buffer: Buffer;

        if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
            this.logger.info({ url: urlOrPath }, 'Downloading plugin from URL');
            const res = await fetch(urlOrPath);
            if (!res.ok) {
                throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, `Failed to fetch plugin: ${res.statusText}`);
            }
            buffer = Buffer.from(await res.arrayBuffer());
        } else {
            // Local file path
            const path = resolve(urlOrPath);
            if (!existsSync(path)) {
                throw new OrchestratorError(ErrorCode.NOT_FOUND, `Plugin file not found: ${path}`);
            }
            this.logger.info({ path }, 'Loading plugin from local file');
            buffer = readFileSync(path);
        }

        const zip = await JSZip.loadAsync(buffer);
        const manifestFile = zip.file('plugin.json');

        if (!manifestFile) {
            throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, 'Invalid plugin: missing plugin.json');
        }

        const manifestJson = await manifestFile.async('string');
        let manifest: PluginManifest;
        try {
            manifest = PluginManifestSchema.parse(JSON.parse(manifestJson));
        } catch (err: any) {
            throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, `Invalid plugin manifest: ${err.message}`);
        }

        const pluginDir = join(this.pluginsDir, manifest.id);
        if (!existsSync(pluginDir)) {
            mkdirSync(pluginDir, { recursive: true });
        }

        // Extract all files
        for (const [filename, file] of Object.entries(zip.files)) {
            if (file.dir) {
                mkdirSync(join(pluginDir, filename), { recursive: true });
            } else {
                const content = await file.async('nodebuffer');
                const dest = join(pluginDir, filename);
                writeFileSync(dest, content);
            }
        }

        this.logger.info({ id: manifest.id, dir: pluginDir }, 'Plugin extracted successfully');
        return { manifest, dir: pluginDir };
    }
}
