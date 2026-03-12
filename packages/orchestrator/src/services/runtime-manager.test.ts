import { describe, it, expect, beforeEach } from 'vitest';
import { RuntimeServiceManager } from './runtime-manager';
import { BuiltinServiceProvider } from './providers/builtin-provider';

describe('RuntimeServiceManager', () => {
    let manager: RuntimeServiceManager;
    let builtinProvider: BuiltinServiceProvider;

    beforeEach(() => {
        manager = new RuntimeServiceManager();
        builtinProvider = new BuiltinServiceProvider();
        builtinProvider.register({
            id: 'orchestrator.test',
            name: 'Test Daemon',
            isCritical: true,
            actions: {
                stop: async () => {},
                restart: async () => {},
                inspect: () => ({ version: "1.0.0" })
            }
        });
        manager.register(builtinProvider);
    });

    it('should list all available services', async () => {
        const services = await manager.list();
        expect(services).toHaveLength(1);
        expect(services[0].id).toBe('orchestrator.test');
        expect(services[0].isCritical).toBe(true);
    });

    it('should correctly inspect a service', async () => {
        const service = await manager.inspect('orchestrator.test');
        expect(service.metadata).toEqual({ version: "1.0.0" });
    });

    it('should fail to restart a critical service without force', async () => {
        await expect(manager.restart('orchestrator.test', false))
            .rejects.toThrow(/marked as critical and cannot be restarted/);
    });

    it('should successfully restart a critical service with force flag', async () => {
        await expect(manager.restart('orchestrator.test', true))
            .resolves.not.toThrow();
    });

    it('should throw NOT_FOUND for non-existent service', async () => {
        await expect(manager.inspect('invalid.service'))
            .rejects.toThrow(/not found in any runtime provider/);
    });
});
