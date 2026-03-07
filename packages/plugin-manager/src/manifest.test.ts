import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginPermissionSchema, PluginManifestSchema } from '../src/manifest.js';

describe('Plugin Manifest Schema', () => {
    it('should validate a valid manifest', () => {
        const valid = {
            id: 'my-plugin',
            name: 'My Plugin',
            version: '1.0.0',
            task: 'chat',
            host_features: {
                contacts: true,
                chat: true,
                ai_inference: true,
                notifications: true,
            },
            permissions: ['db:read', 'vault:read:foo'],
            entrypoint: 'plugin.wasm'
        };
        const result = PluginManifestSchema.safeParse(valid);
        expect(result.success).toBe(true);
    });

    it('should reject invalid version', () => {
        const invalid = {
            id: 'my-plugin',
            name: 'My Plugin',
            version: 'beta',
            permissions: []
        };
        const result = PluginManifestSchema.safeParse(invalid);
        expect(result.success).toBe(false);
    });

    it('should reject uppercase ID', () => {
        const invalid = {
            id: 'My-Plugin',
            name: 'My Plugin',
            version: '1.0.0',
            permissions: []
        };
        const result = PluginManifestSchema.safeParse(invalid);
        expect(result.success).toBe(false);
    });

    it('should export typed task permissions', () => {
        expect(PluginPermissionSchema.options).toContain('contacts:read');
        expect(PluginPermissionSchema.options).toContain('chat:write');
        expect(PluginPermissionSchema.options).toContain('agent:run');
        expect(PluginPermissionSchema.options).toContain('notifications:publish');
    });
});
