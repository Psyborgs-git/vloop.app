import { z } from 'zod';

export const PluginPermissionSchema = z.enum([
    'db:read',
    'db:write',
    'vault:read',
    'vault:write',
    'events:subscribe',
    'events:publish',
    'network:outbound', // For future use
]);

export type PluginPermission = z.infer<typeof PluginPermissionSchema>;

export const PluginManifestSchema = z.object({
    id: z.string().regex(/^[a-z0-9-]+$/, 'Plugin ID must be lowercase alphanumeric with dashes'),
    name: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be semver (x.y.z)'),
    description: z.string().optional(),
    author: z.string().optional(),
    entrypoint: z.string().default('plugin.wasm'),
    permissions: z.array(z.string()).default([]),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;
