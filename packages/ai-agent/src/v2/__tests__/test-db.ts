/**
 * Test helper — creates an in-memory SQLite database with v2 schema.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { V2_MIGRATION } from '../migrations.js';
import { aiAgentV2Schema } from '../schema.js';
import type { AiAgentOrm } from '../orm-type.js';

export function createTestDb(): { db: InstanceType<typeof Database>; orm: AiAgentOrm } {
	const db = new Database(':memory:');
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	db.exec(V2_MIGRATION);
	const orm = drizzle(db, { schema: aiAgentV2Schema }) as AiAgentOrm;
	return { db, orm };
}
