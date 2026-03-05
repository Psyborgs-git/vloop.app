import { eq } from 'drizzle-orm';
import { pluginsTable, initPluginManagerSchema } from './schema.js';
import type { RootDatabaseOrm } from '@orch/shared/db';
import type { PluginManifest } from './manifest.js';

export interface PluginRecord {
    id: string;
    enabled: boolean;
    manifest: PluginManifest;
    granted_permissions: string[];
    installed_at: string;
    db_id?: string;
}

export class PluginStore {
    private orm: RootDatabaseOrm;

    constructor(db: { exec(sql: string): unknown }, orm: RootDatabaseOrm) {
        initPluginManagerSchema(db);
        this.orm = orm;
    }

    public install(manifest: PluginManifest, grantedPermissions: string[], dbId?: string): void {
        const now = new Date().toISOString();
        this.orm
            .insert(pluginsTable)
            .values({
                id: manifest.id,
                enabled: 1,
                manifest: JSON.stringify(manifest),
                granted_permissions: JSON.stringify(grantedPermissions),
                installed_at: now,
                db_id: dbId ?? null,
            })
            .onConflictDoUpdate({
                target: pluginsTable.id,
                set: {
                    enabled: 1,
                    manifest: JSON.stringify(manifest),
                    granted_permissions: JSON.stringify(grantedPermissions),
                    installed_at: now,
                    db_id: dbId ?? null,
                },
            })
            .run();
    }

    public uninstall(id: string): void {
        this.orm.delete(pluginsTable).where(eq(pluginsTable.id, id)).run();
    }

    public get(id: string): PluginRecord | undefined {
        const row = this.orm.select().from(pluginsTable).where(eq(pluginsTable.id, id)).get() as any;
        if (!row) return undefined;
        return this.mapRow(row);
    }

    public list(): PluginRecord[] {
        const rows = this.orm.select().from(pluginsTable).all() as any[];
        return rows.map(this.mapRow);
    }

    public setEnabled(id: string, enabled: boolean): void {
        this.orm
            .update(pluginsTable)
            .set({ enabled: enabled ? 1 : 0 })
            .where(eq(pluginsTable.id, id))
            .run();
    }

    private mapRow(row: any): PluginRecord {
        return {
            id: row.id,
            enabled: row.enabled === 1,
            manifest: JSON.parse(row.manifest),
            granted_permissions: JSON.parse(row.granted_permissions),
            installed_at: row.installed_at,
            db_id: row.db_id,
        };
    }
}
