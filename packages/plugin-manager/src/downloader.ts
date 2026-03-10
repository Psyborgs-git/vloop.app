import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, cpSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
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

        // Support remote urls (http, https, ftp) as well as local file paths and
        // file:// URLs. The latter can come in either with one or two slashes after
        // the protocol; treat them as local paths instead of passing them to
        // `fetch`, which doesn't resolve relative paths correctly and would cause
        // the working-directory prefix seen in the error log.
        if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://') || urlOrPath.startsWith('ftp://')) {
            this.logger.info({ url: urlOrPath }, 'Downloading plugin from URL');
            const res = await fetch(urlOrPath);
            if (!res.ok) {
                throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, `Failed to fetch plugin: ${res.statusText}`);
            }
            buffer = Buffer.from(await res.arrayBuffer());
        } else {
            // Treat everything else as a local file. This covers both plain paths and
            // file:// URLs. Some callers (notably the CLI) have historically
            // concatenated the current working directory onto the front of the
            // string when they couldn't parse a URL; in that situation we may receive
            // a value like
            //   "/users/app/packages/orchestrator/file:/Users/…/plugin.zip"
            // which would confuse `resolve()` and lead to the "file not found"
            // error observed in the logs. To be robust we strip out any leading
            // garbage preceding the first `file:` prefix before proceeding.
            let path = urlOrPath;

            const idx = path.indexOf('file:');
            if (idx > 0) {
                // Drop everything before the `file:` so our normal handling kicks in
                path = path.slice(idx);
            }

            if (path.startsWith('file:')) {
                try {
                    const u = new URL(path);
                    path = u.pathname;
                } catch {
                    throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, `Invalid file URL: ${urlOrPath}`);
                }
            }

            path = resolve(path);
            if (!existsSync(path)) {
                throw new OrchestratorError(ErrorCode.NOT_FOUND, `Plugin file not found: ${path}`);
            }

            // Directory → copy contents directly, no ZIP needed
            const fstat = statSync(path);
            if (fstat.isDirectory()) {
                this.logger.info({ path }, 'Loading plugin from directory');
                return this.copyFromDirectory(path);
            }

            // plugin.json path → use its parent directory
            if (path.endsWith('.json')) {
                this.logger.info({ path }, 'Loading plugin from plugin.json');
                return this.copyFromDirectory(dirname(path));
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
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, `Invalid plugin manifest: ${msg}`);
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

    /**
     * Copy a plugin from an existing directory (rather than extracting a ZIP).
     * The source directory must contain a valid plugin.json at its root.
     */
    private copyFromDirectory(sourceDir: string): { manifest: PluginManifest; dir: string } {
        const manifestPath = join(sourceDir, 'plugin.json');
        if (!existsSync(manifestPath)) {
            throw new OrchestratorError(
                ErrorCode.VALIDATION_ERROR,
                `Invalid plugin directory: missing plugin.json in ${sourceDir}`,
            );
        }

        let manifest: PluginManifest;
        try {
            manifest = PluginManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf-8')));
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new OrchestratorError(ErrorCode.VALIDATION_ERROR, `Invalid plugin manifest: ${msg}`);
        }

        const pluginDir = join(this.pluginsDir, manifest.id);
        mkdirSync(pluginDir, { recursive: true });
        cpSync(sourceDir, pluginDir, { recursive: true, force: true });

        this.logger.info({ id: manifest.id, dir: pluginDir }, 'Plugin copied from directory');
        return { manifest, dir: pluginDir };
    }
}
