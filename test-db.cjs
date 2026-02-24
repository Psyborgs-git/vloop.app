const Database = require('better-sqlite3-multiple-ciphers');
try {
  const db = new Database('packages/orchestrator/data/state.db');
  db.pragma("key='super-secret-db-passphrase-must-be-long-enough'");
  db.prepare('SELECT count(*) FROM sqlite_master').get();
  console.log('Success with super-secret');
} catch (e) {
  console.error('Failed with super-secret:', e.message);
}
