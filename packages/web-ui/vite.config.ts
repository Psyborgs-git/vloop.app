import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// TLS is now terminated at the gateway layer (packages/gateway), not here.
// Certs are injected via environment at runtime — never committed to the repo.
// In local dev, if cert files exist they are used; otherwise we fall back to HTTP.
function loadCerts() {
    const keyPath = resolve(__dirname, '../../certs/server.key');
    const certPath = resolve(__dirname, '../../certs/server.crt');
    const caPath = resolve(__dirname, '../../certs/ca.crt');
    if (!existsSync(keyPath) || !existsSync(certPath)) return undefined;

    // ca.crt is optional in local dev (it is injected in production environments)
    // and may be removed between the existsSync check and readFileSync call.
    let ca: Buffer | undefined;
    try {
        if (existsSync(caPath)) {
            ca = readFileSync(caPath);
        }
    } catch {
        // best-effort; fall back to HTTP if ca.crt isn't available.
    }

    return {
        key: readFileSync(keyPath),
        cert: readFileSync(certPath),
        ...(ca ? { ca } : {}),
    };
}

const certs = loadCerts();

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        tailwindcss() as any // Workaround for vite/vitest plugin type mismatch
    ],
    server: {
        // serve over HTTPS using the same certs the daemon uses so the
        // browser will allow secure websocket upgrades and avoid mixed
        // content/blocked requests.
        ...(certs ? { https: certs } : {}),
        port: 3000,
        "host": "0.0.0.0",
        allowedHosts: ['localhost', 'jae.local'],
        proxy: {
            '/api/ws': {
                target: 'wss://jae.local:9443',
                ws: true,
                changeOrigin: true,
                secure: false, // bypass self-signed cert checks in dev proxy
            }
        }
    }
});
