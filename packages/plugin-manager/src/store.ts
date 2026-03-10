import { eq, and } from 'drizzle-orm';
import { pluginsTable, pluginSettingsTable, initPluginManagerSchema } from './schema.js';
import type { RootDatabaseOrm } from '@orch/shared/db';
import type { PluginManifest } from './manifest.js';

/** Raw Drizzle row shape for the plugins table. */
type PluginRow = typeof pluginsTable.$inferSelect;

export interface PluginRecord {
    id: string;
    enabled: boolean;
    manifest: PluginManifest;
    granted_permissions: string[];
    installed_at: string;
}

export class PluginStore {
    private orm: RootDatabaseOrm;

    constructor(db: { exec(sql: string): unknown }, orm: RootDatabaseOrm) {
        initPluginManagerSchema(db);
        this.orm = orm;
    }

    public install(manifest: PluginManifest, grantedPermissions: string[]): void {
        const now = new Date().toISOString();
        this.orm
            .insert(pluginsTable)
            .values({
                id: manifest.id,
                enabled: 1,
                manifest: JSON.stringify(manifest),
                granted_permissions: JSON.stringify(grantedPermissions),
                installed_at: now,
            })
            .onConflictDoUpdate({
                target: pluginsTable.id,
                set: {
                    enabled: 1,
                    manifest: JSON.stringify(manifest),
                    granted_permissions: JSON.stringify(grantedPermissions),
                    installed_at: now,
                },
            })
            .run();
    }

    public uninstall(id: string): void {
        this.orm.delete(pluginsTable).where(eq(pluginsTable.id, id)).run();
    }

    public get(id: string): PluginRecord | undefined {
        const row = this.orm.select().from(pluginsTable).where(eq(pluginsTable.id, id)).get() as PluginRow | undefined;
        if (!row) return undefined;
        return this.mapRow(row);
    }

    public list(): PluginRecord[] {
        const rows = this.orm.select().from(pluginsTable).all() as PluginRow[];
        return rows.map(this.mapRow);
    }

    public setEnabled(id: string, enabled: boolean): void {
        this.orm
            .update(pluginsTable)
            .set({ enabled: enabled ? 1 : 0 })
            .where(eq(pluginsTable.id, id))
            .run();
    }

    public getSetting(pluginId: string, key: string): string | undefined {
        const row = this.orm.select({ value: pluginSettingsTable.value })
            .from(pluginSettingsTable)
            .where(and(eq(pluginSettingsTable.plugin_id, pluginId), eq(pluginSettingsTable.key, key)))
            .get();
        return row?.value;
    }

    public setSetting(pluginId: string, key: string, value: string): void {
        this.orm.insert(pluginSettingsTable)
            .values({ plugin_id: pluginId, key, value })
            .onConflictDoUpdate({
                target: [pluginSettingsTable.plugin_id, pluginSettingsTable.key],
                set: { value }
            })
            .run();
    }

    public deleteSetting(pluginId: string, key: string): void {
        this.orm.delete(pluginSettingsTable)
            .where(and(eq(pluginSettingsTable.plugin_id, pluginId), eq(pluginSettingsTable.key, key)))
            .run();
    }

    private mapRow(row: PluginRow): PluginRecord {
        return {
            id: row.id,
            enabled: row.enabled === 1,
            manifest: JSON.parse(row.manifest),
            granted_permissions: JSON.parse(row.granted_permissions),
            installed_at: row.installed_at,
        };
    }
}
