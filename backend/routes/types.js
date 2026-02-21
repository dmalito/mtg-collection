const express = require('express');
const router = express.Router();
const db = require('../db');

// Get all tracked types
router.get('/', (req, res) => {
  db.all('SELECT * FROM tracked_types ORDER BY name', (err, types) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(types);
  });
});

// Add a new type to track
router.post('/', (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'name required' });
  }

  db.run('INSERT INTO tracked_types (name) VALUES (?)', [name.toLowerCase()], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(409).json({ error: 'Type already tracked' });
      }
      return res.status(500).json({ error: 'Database error' });
    }

    res.json({ id: this.lastID, name: name.toLowerCase() });
  });
});

// Remove a tracked type
router.delete('/:name', (req, res) => {
  const { name } = req.params;

  db.run('DELETE FROM tracked_types WHERE name = ?', [name.toLowerCase()], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Type not found' });
    }

    res.json({ success: true, deleted: this.changes });
  });
});

module.exports = router;