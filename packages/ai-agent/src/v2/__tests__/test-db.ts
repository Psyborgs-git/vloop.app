/**
 * Test helper — creates an in-memory SQLite database with v2 schema.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { V2_MIGRATION } from '../migrations.js';
import type { RootDatabaseOrm } from '@orch/shared/db';

export function createTestDb(): { db: InstanceType<typeof Database>; orm: RootDatabaseOrm } {
	const db = new Database(':memory:');
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	db.exec(V2_MIGRATION);
	const orm = drizzle(db);
	return { db, orm };
}
