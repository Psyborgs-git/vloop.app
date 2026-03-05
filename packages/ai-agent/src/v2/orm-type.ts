/**
 * AiAgentOrm — schema-bound Drizzle ORM type for the AI Agent v2 database.
 *
 * Using ReturnType<typeof drizzle<TSchema>> resolved from this package's own
 * drizzle-orm import ensures a single type identity and full type inference
 * for relational queries (orm.query.xxx.findFirst({ with: { ... } })).
 */

import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { aiAgentV2Schema } from './schema.js';

export type AiAgentOrm = ReturnType<typeof drizzle<typeof aiAgentV2Schema>>;
