import Database from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

const db = new Database(':memory:');
const orm = drizzle(db);

const tbl = sqliteTable('foo', {
  id: text('id').primaryKey(),
  parent_id: text('parent_id'),
});

db.run("CREATE TABLE foo (id TEXT PRIMARY KEY, parent_id TEXT)");
db.run("INSERT INTO foo (id, parent_id) VALUES ('a', NULL), ('b', 'a'), ('c', 'b')");

import { sql } from 'drizzle-orm';

const res = orm.run(sql`
WITH RECURSIVE ancestry AS (
	SELECT * FROM ${tbl} WHERE id = 'c'
	UNION ALL
	SELECT m.* FROM ${tbl} m
	JOIN ancestry a ON m.id = a.parent_id
)
SELECT * FROM ancestry;
`);

console.log(res);

const res2 = orm.all(sql`
WITH RECURSIVE ancestry AS (
	SELECT * FROM ${tbl} WHERE id = 'c'
	UNION ALL
	SELECT m.* FROM ${tbl} m
	JOIN ancestry a ON m.id = a.parent_id
)
SELECT * FROM ancestry;
`);
console.log(res2);
