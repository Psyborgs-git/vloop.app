/**
 * Fix execute permissions on node-pty prebuilt binaries.
 *
 * macOS and some Linux environments unpack tarballs without preserving
 * the execute bit on native binaries, causing `posix_spawnp failed.`
 * at runtime. This script restores the correct permissions.
 *
 * Run via: node scripts/fix-pty-permissions.mjs
 * Called automatically from the root `prepare` lifecycle script.
 */

import { chmodSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const prebuilds = join(root, 'node_modules', 'node-pty', 'prebuilds');

if (!existsSync(prebuilds)) {
    // node-pty not installed yet — nothing to do.
    process.exit(0);
}

let fixed = 0;
for (const arch of readdirSync(prebuilds)) {
    const archDir = join(prebuilds, arch);
    if (!statSync(archDir).isDirectory()) continue;
    for (const file of readdirSync(archDir)) {
        const filePath = join(archDir, file);
        try {
            chmodSync(filePath, 0o755);
            fixed++;
        } catch {
            // Ignore errors (e.g. on read-only filesystems).
        }
    }
}

if (fixed > 0) {
    console.log(`[fix-pty-permissions] Fixed permissions on ${fixed} node-pty file(s).`);
}
