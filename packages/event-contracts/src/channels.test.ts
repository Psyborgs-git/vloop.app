/**
 * Tests for @orch/event-contracts — channel constants & helpers
 */

import { describe, it, expect } from 'vitest';
import {
    CHANNELS,
    KEYS,
    SERVICES,
    resultChannel,
    wsSessionKey,
    serviceCommandChannel,
} from './channels.js';

describe('CHANNELS', () => {
    it('should define all required command channels', () => {
        expect(CHANNELS.GATEWAY_INBOUND).toBe('gateway:inbound');
        expect(CHANNELS.TERMINAL_COMMANDS).toBe('terminal:commands');
        expect(CHANNELS.AI_REQUESTS).toBe('ai:requests');
        expect(CHANNELS.FS_OPS).toBe('fs:ops');
        expect(CHANNELS.VAULT_OPS).toBe('vault:ops');
        expect(CHANNELS.AUDIT_STREAM).toBe('audit:stream');
    });
});

describe('KEYS', () => {
    it('should define all required key prefixes', () => {
        expect(KEYS.WS_SESSIONS).toBe('ws:sessions');
        expect(KEYS.SERVICE_REGISTRY).toBe('service:registry');
    });
});

describe('SERVICES', () => {
    it('should define all canonical service names', () => {
        expect(SERVICES.TERMINAL).toBe('terminal');
        expect(SERVICES.AI).toBe('ai');
        expect(SERVICES.FS).toBe('fs');
        expect(SERVICES.VAULT).toBe('vault');
    });
});

describe('resultChannel', () => {
    it('should build a per-session result channel', () => {
        expect(resultChannel('terminal', 'ws_xyz')).toBe('terminal:results:ws_xyz');
        expect(resultChannel('ai', 'sess_123')).toBe('ai:results:sess_123');
    });
});

describe('wsSessionKey', () => {
    it('should build a Redis key for a WebSocket session', () => {
        expect(wsSessionKey('conn_abc')).toBe('ws:sessions:conn_abc');
    });
});

describe('serviceCommandChannel', () => {
    it('should map each service name to its command channel', () => {
        expect(serviceCommandChannel('terminal')).toBe('terminal:commands');
        expect(serviceCommandChannel('ai')).toBe('ai:requests');
        expect(serviceCommandChannel('fs')).toBe('fs:ops');
        expect(serviceCommandChannel('vault')).toBe('vault:ops');
    });
});
