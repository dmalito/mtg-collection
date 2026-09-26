const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// DATA_DIR lets the Docker image keep the db on a bind-mounted volume
const dbPath = path.join(process.env.DATA_DIR || __dirname, 'mtg.db');
const db = new sqlite3.Database(dbPath);

// Initialize database schema
db.serialize(() => {
  // Cards you own
  db.run(`
    CREATE TABLE IF NOT EXISTS owned_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scryfall_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      set_code TEXT NOT NULL,
      collector_number TEXT NOT NULL,
      rarity TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      condition TEXT DEFAULT 'NM',
      acquired_at TEXT DEFAULT (datetime('now')),
      notes TEXT,
      illustration_id TEXT,
      released_at TEXT
    )
  `);

  // Migrations for databases created before a column existed.
  //  - illustration_id lets art-based owned matching (see artDedupe.js) work
  //    on rows added before it, once backfilled.
  //  - released_at orders the binder view (routes/binder.js), which fills it
  //    in lazily from Scryfall for rows that predate it.
  db.all("PRAGMA table_info(owned_cards)", (err, columns) => {
    if (err) return;
    if (!columns.some((c) => c.name === 'illustration_id')) {
      db.run('ALTER TABLE owned_cards ADD COLUMN illustration_id TEXT');
    }
    if (!columns.some((c) => c.name === 'released_at')) {
      db.run('ALTER TABLE owned_cards ADD COLUMN released_at TEXT');
    }
  });

  // Creature types you're tracking
  db.run(`
    CREATE TABLE IF NOT EXISTS tracked_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      added_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Add dinosaur as default type
  db.run(`
    INSERT OR IGNORE INTO tracked_types (name) VALUES ('dinosaur')
  `);
});

module.exports = db;