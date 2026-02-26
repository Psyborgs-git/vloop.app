import type { Logger } from "@orch/daemon";
import type { Database } from "@orch/shared/db";
import type { PluginRecord, PluginManifest } from "./types.js";

export class PluginStore {
    private db: Database;
    private logger: Logger;

    constructor(db: Database, logger: Logger) {
        this.db = db;
        this.logger = logger;
        this.init();
    }

    private init() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS plugins (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                version TEXT NOT NULL,
                manifest TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                installed_at TEXT DEFAULT (datetime('now')),
                permissions TEXT DEFAULT '[]',
                config TEXT DEFAULT '{}'
            );
        `);
        this.logger.info("PluginStore initialized");
    }

    add(manifest: PluginManifest): void {
        const stmt = this.db.prepare(`
            INSERT INTO plugins (id, name, version, manifest, status, permissions)
            VALUES (?, ?, ?, ?, 'pending', '[]')
        `);
        stmt.run(
            manifest.id,
            manifest.name,
            manifest.version,
            JSON.stringify(manifest),
        );
        this.logger.info({ id: manifest.id }, "Plugin added to store");
    }

    get(id: string): PluginRecord | undefined {
        const stmt = this.db.prepare("SELECT * FROM plugins WHERE id = ?");
        const row = stmt.get(id) as any;
        if (!row) return undefined;

        return {
            id: row.id,
            manifest: JSON.parse(row.manifest),
            status: row.status,
            installedAt: row.installed_at,
            permissions: JSON.parse(row.permissions),
            config: JSON.parse(row.config),
        };
    }

    list(): PluginRecord[] {
        const stmt = this.db.prepare("SELECT * FROM plugins");
        const rows = stmt.all() as any[];
        return rows.map((row) => ({
            id: row.id,
            manifest: JSON.parse(row.manifest),
            status: row.status,
            installedAt: row.installed_at,
            permissions: JSON.parse(row.permissions),
            config: JSON.parse(row.config),
        }));
    }

    updateStatus(id: string, status: PluginRecord["status"]): void {
        const stmt = this.db.prepare("UPDATE plugins SET status = ? WHERE id = ?");
        stmt.run(status, id);
        this.logger.info({ id, status }, "Plugin status updated");
    }

    grantPermissions(id: string, permissions: string[]): void {
        const stmt = this.db.prepare("UPDATE plugins SET permissions = ? WHERE id = ?");
        stmt.run(JSON.stringify(permissions), id);
        this.logger.info({ id, permissions }, "Plugin permissions granted");
    }

    delete(id: string): void {
        const stmt = this.db.prepare("DELETE FROM plugins WHERE id = ?");
        stmt.run(id);
        this.logger.info({ id }, "Plugin removed from store");
    }
}
