import { OrchestratorError, ErrorCode } from '@orch/shared';
import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';
import { PluginManifest } from './manifest.js';

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

    constructor(db: BetterSqlite3.Database) {
        this.db = db;
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
        this.db.prepare(`
            INSERT OR REPLACE INTO plugins (id, enabled, manifest, granted_permissions, installed_at, db_id)
            VALUES (?, 1, ?, ?, ?, ?)
        `).run(
            manifest.id,
            JSON.stringify(manifest),
            JSON.stringify(grantedPermissions),
            now,
            dbId
        );
    }

    public uninstall(id: string): void {
        this.db.prepare('DELETE FROM plugins WHERE id = ?').run(id);
    }

    public get(id: string): PluginRecord | undefined {
        const row = this.db.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as any;
        if (!row) return undefined;
        return this.mapRow(row);
    }

    public list(): PluginRecord[] {
        const rows = this.db.prepare('SELECT * FROM plugins').all() as any[];
        return rows.map(this.mapRow);
    }

    public setEnabled(id: string, enabled: boolean): void {
        this.db.prepare('UPDATE plugins SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
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
