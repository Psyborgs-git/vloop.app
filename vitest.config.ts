import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '@orch/shared/hooks-bus': path.resolve(__dirname, 'packages/shared/src/hooks-bus.ts'),
            '@orch/shared/db': path.resolve(__dirname, 'packages/shared/src/db.ts'),
            '@orch/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
            '@orch/event-contracts': path.resolve(__dirname, 'packages/event-contracts/src/index.ts'),
            '@orch/gateway': path.resolve(__dirname, 'packages/gateway/src/index.ts'),
            '@orch/daemon': path.resolve(__dirname, 'packages/daemon/src/index.ts'),
            '@orch/container': path.resolve(__dirname, 'packages/container/src/index.ts'),
            '@orch/auth': path.resolve(__dirname, 'packages/auth/src/index.ts'),
            '@orch/db-manager': path.resolve(__dirname, 'packages/db-manager/src/index.ts'),
            '@orch/vault': path.resolve(__dirname, 'packages/vault/src/index.ts'),
            '@orch/client': path.resolve(__dirname, 'packages/client/src/index.ts'),
        }
    },
    test: {
        globals: true,
        environment: 'node',
        include: ['packages/*/src/**/*.test.ts', 'tests/**/*.test.ts'],
        exclude: ['node_modules', 'dist'],
        coverage: {
            provider: 'v8',
            include: ['packages/*/src/**/*.ts'],
            exclude: ['**/*.test.ts', '**/*.d.ts'],
        },
    },
});
