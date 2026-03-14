import { sql } from 'drizzle-orm';
export function test() {
    return sql`
WITH RECURSIVE ancestry AS (
    SELECT * FROM ai_messages WHERE id = ${"test"}
    UNION ALL
    SELECT m.* FROM ai_messages m
    JOIN ancestry a ON m.id = a.parent_id
)
SELECT * FROM ancestry;
`;
}
