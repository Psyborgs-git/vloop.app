import { describe, it, expect, beforeEach } from 'vitest';
import { BuiltinServiceProvider } from '../../packages/orchestrator/src/services/providers/builtin-provider';

describe('BuiltinServiceProvider Integration', () => {
    let provider: BuiltinServiceProvider;

    beforeEach(() => {
        provider = new BuiltinServiceProvider();
        provider.register({
            id: 'test.db',
            name: 'Test Database',
            isCritical: true,
            actions: {
                inspect: () => ({ isOpen: true }),
                stop: async () => {},
                restart: async () => {} 
            }
        });
    });

    it('should list registered builtin services', () => {
        const services = provider.list();
        expect(services).toHaveLength(1);
        expect(services[0].id).toBe('test.db');
        expect(services[0].isCritical).toBe(true);
        expect(services[0].metadata).toEqual({ isOpen: true });
    });

    it('should inspect a registered builtin service', () => {
        const result = provider.inspect('test.db');
        expect(result.id).toBe('test.db');
        expect(result.metadata).toEqual({ isOpen: true });
    });

    it('should report isCritical correctly', () => {
        expect(provider.isCritical('test.db')).toBe(true);
    });

    it('should handle service restart successfully', async () => {
        await expect(provider.restart('test.db')).resolves.not.toThrow();
    });

    it('should throw on restart if not supported', async () => {
        provider.register({
            id: 'no.restart',
            name: 'No Restart Node',
            isCritical: false,
            actions: {}
        });
        await expect(provider.restart('no.restart')).rejects.toThrow();
    });

    it('should handle service stop successfully', async () => {
        await expect(provider.stop('test.db')).resolves.not.toThrow();
    });
});
