/**
 * Tests for @orch/daemon/config
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'orch-config-test-'));
    });

    afterEach(() => {
        // Clean up ORCH_ env vars set during tests
        for (const key of Object.keys(process.env)) {
            if (key.startsWith('ORCH_')) {
                delete process.env[key];
            }
        }
        rmSync(tempDir, { recursive: true, force: true });
    });

    const validConfig = `
[daemon]
pid_file = "/tmp/test.pid"
log_level = "debug"

[network]
bind_address = "127.0.0.1"
ws_port = 9443
health_port = 9444
max_connections = 100

[tls]
cert_path = "./certs/test.crt"
key_path = "./certs/test.key"

[auth]
jwt_public_key_path = "./certs/jwt.pem"
jwt_algorithm = "RS256"
jwt_issuer = "test"
jwt_audience = "test-api"

[database]
path = "./data/test.db"
`;

    it('should load a valid TOML config', () => {
        const configPath = join(tempDir, 'config.toml');
        writeFileSync(configPath, validConfig);

        const config = loadConfig(configPath);
        expect(config.daemon.log_level).toBe('debug');
        expect(config.daemon.pid_file).toBe('/tmp/test.pid');
        expect(config.network.bind_address).toBe('127.0.0.1');
        expect(config.network.ws_port).toBe(9443);
        expect(config.tls.cert_path).toBe('./certs/test.crt');
        expect(config.auth.jwt_algorithm).toBe('RS256');
    });

    it('should throw for missing config file', () => {
        expect(() => loadConfig('/nonexistent/path/config.toml')).toThrow('Config file not found');
    });

    it('should throw for invalid TOML syntax', () => {
        const configPath = join(tempDir, 'bad.toml');
        writeFileSync(configPath, 'not valid [toml =');

        expect(() => loadConfig(configPath)).toThrow();
    });

    it('should throw for missing required fields', () => {
        const configPath = join(tempDir, 'incomplete.toml');
        writeFileSync(configPath, `
[daemon]
log_level = "info"
# Missing tls and auth sections
`);
        expect(() => loadConfig(configPath)).toThrow('Config validation failed');
    });

    it('should apply environment variable overrides', () => {
        const configPath = join(tempDir, 'config.toml');
        writeFileSync(configPath, validConfig);

        process.env['ORCH_NETWORK_WS_PORT'] = '8888';
        process.env['ORCH_DAEMON_LOG_LEVEL'] = 'warn';
        process.env['ORCH_DAEMON_PID_FILE'] = '/tmp/override.pid';

        const config = loadConfig(configPath);
        expect(config.network.ws_port).toBe(8888);
        expect(config.daemon.log_level).toBe('warn');
        expect(config.daemon.pid_file).toBe('/tmp/override.pid');    });

    it('should use default values for optional fields', () => {
        const configPath = join(tempDir, 'config.toml');
        writeFileSync(configPath, validConfig);

        const config = loadConfig(configPath);
        // These should have defaults from the Zod schema
        expect(config.vault.max_secret_versions).toBe(5);
        expect(config.vault.soft_delete_retention_days).toBe(30);
        expect(config.network.ping_interval_secs).toBe(30);
        expect(config.network.pong_timeout_secs).toBe(10);
    });
});
