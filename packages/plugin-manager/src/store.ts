import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';
import type { RootDatabaseOrm } from '@orch/shared/db';
import { eq } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { PluginManifest } from './manifest.js';

const pluginsTable = sqliteTable('plugins', {
    id: text('id').primaryKey(),
    enabled: integer('enabled').notNull().default(1),
    manifest: text('manifest').notNull(),
    granted_permissions: text('granted_permissions').notNull(),
    installed_at: text('installed_at').notNull(),
    db_id: text('db_id'),
});

export interface PluginRecord {
    id: string;
    enabled: boolean;
    manifest: PluginManifest;
    granted_permissions: string[];
    installed_at: string;
    db_id?: string;
}

export class PluginStore {
    private db: BetterSqlite3.Database;
    private orm: RootDatabaseOrm;

    constructor(db: BetterSqlite3.Database, orm: RootDatabaseOrm) {
        this.db = db;
        this.orm = orm;
        this.initSchema();
    }

    private initSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS plugins (
                id TEXT PRIMARY KEY,
                enabled INTEGER DEFAULT 1,
                manifest TEXT NOT NULL,
                granted_permissions TEXT NOT NULL,
                installed_at TEXT NOT NULL,
                db_id TEXT
            );
        `);
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
