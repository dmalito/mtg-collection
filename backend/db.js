const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'mtg.db');
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
      notes TEXT
    )
  `);

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