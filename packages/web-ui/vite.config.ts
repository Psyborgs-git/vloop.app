import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        tailwindcss() as any // Workaround for vite/vitest plugin type mismatch
    ],
    server: {
        port: 3000,
        proxy: {
            '/api/ws': {
                target: 'wss://localhost:9443',
                ws: true,
                changeOrigin: true,
                secure: false, // Bypass self-signed cert checks in dev
                rewrite: (path) => path.replace(/^\/api\/ws/, '')
            }
        }
    }
});
