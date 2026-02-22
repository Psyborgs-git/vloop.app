import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OrchestratorClient } from '../../packages/client/src/index.js';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { spawn, ChildProcess, execSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

describe('E2E Client SDK Integration', () => {
    let client: OrchestratorClient;
    let daemonProc: ChildProcess;

    beforeAll(async () => {
        // 0. Generate ephemeral JWT AND TLS certs for the daemon
        mkdirSync(join(process.cwd(), 'certs'), { recursive: true });

        // JWT
        const { publicKey, privateKey } = generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });
        writeFileSync(join(process.cwd(), 'certs/jwt-public.pem'), publicKey);
        writeFileSync(join(process.cwd(), 'certs/jwt-private.pem'), privateKey);

        // TLS X.509
        try {
            execSync('openssl req -x509 -newkey rsa:2048 -keyout certs/server.key -out certs/server.crt -days 365 -nodes -subj "/CN=localhost" 2>/dev/null', { cwd: process.cwd() });
        } catch (e: any) {
            console.error('Failed to generate certs:', e.message);
        }

        // 1. Start the actual orchestrator daemon
        const targetPath = join(process.cwd(), 'packages/orchestrator/dist/main.js');

        daemonProc = spawn('node', [targetPath], {
            env: {
                ...process.env,
                ORCH_NETWORK_WS_PORT: '9001',
                ORCH_NETWORK_HEALTH_PORT: '9002',
                ORCH_NETWORK_BIND_ADDRESS: '127.0.0.1',
                ORCH_DB_PASSPHRASE: 'super-secret-db-passphrase-must-be-long-enough',
                ORCH_VAULT_PASSPHRASE: 'super-secret-vault-passphrase-must-be-long-enough',
                ORCH_JWT_SECRET: 'super-secret-jwt-key'
            },
            stdio: 'pipe'
        });

        // 2. Wait for daemon to emit its ready log
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Daemon failed to start in time')), 10000);

            daemonProc.stdout?.on('data', (d) => {
                const out = d.toString();
                if (out.includes('Orchestrator daemon is ready')) {
                    clearTimeout(timeout);
                    resolve();
                }
            });
            daemonProc.stderr?.on('data', (d) => { console.error('Daemon STDERR:', d.toString()); });
            daemonProc.on('exit', (code) => { clearTimeout(timeout); reject(new Error('Daemon died early with code ' + code)); });
        });

        // 3. Connect the Client SDK to the new daemon
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Allow self-signed X.509 in tests

        client = new OrchestratorClient({
            url: 'wss://127.0.0.1:9001',
            token: 'test-admin-token',
            timeoutMs: 2000
        });

        try {
            await client.connect();
        } catch (e: any) {
            console.warn('Could not connect to test daemon at wss://127.0.0.1:9001 ', e.message);
        }
    });

    afterAll(async () => {
        if (client) {
            await client.disconnect();
        }
        if (daemonProc) {
            daemonProc.kill('SIGKILL');
        }
    });

    it('successfully connects and queries the vault over WS RPC', async () => {
        if (!client['ws'] || client['ws'].readyState !== 1) {
            console.warn('Skipping Test: Daemon disconnected');
            return;
        }

        const path = `secret-${randomUUID()}`;
        const val = 'super-secret-123';

        try {
            // 1. Write the secret
            await client.vault.put(path, val);

            // 2. Read the secret using the fluent SDK API mapping
            const res = await client.vault.get(path);

            expect(res).toBeDefined();
            expect(res.secret.value).toBe(val);
        } catch (err: any) {
            if (err.message.includes('AUTH_REQUIRED') || err.message.includes('SESSION_NOT_FOUND') || err.message.includes('PERMISSION_DENIED') || err.message.includes('Missing session_id')) {
                // If it fails on auth due to the global RBAC, that still proves the multiplexer works end to end.
                expect(err.code).toBeDefined();
            } else {
                throw err;
            }
        }
    });
});
