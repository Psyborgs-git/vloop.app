import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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
        https: {
            key: readFileSync(resolve(__dirname, '../../certs/server.key')),
            cert: readFileSync(resolve(__dirname, '../../certs/server.crt')),
            // optionally pass ca if needed,
            ca: readFileSync(resolve(__dirname, '../../certs/ca.crt')),
        },
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
