const express = require('express');
const router = express.Router();
const db = require('../db');

// Get all owned cards
router.get('/', (req, res) => {
  db.all('SELECT * FROM owned_cards ORDER BY acquired_at DESC', (err, cards) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(cards);
  });
});

// Add a card to collection
router.post('/', async (req, res) => {
  const { scryfallId, quantity = 1, condition = 'NM', notes = '' } = req.body;

  if (!scryfallId) {
    return res.status(400).json({ error: 'scryfallId required' });
  }

  try {
    // Fetch card details from Scryfall
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(`https://api.scryfall.com/cards/${scryfallId}`);
    
    if (!response.ok) {
      return res.status(404).json({ error: 'Card not found on Scryfall' });
    }

    const card = await response.json();

    // Insert or update in database
    db.run(`
      INSERT INTO owned_cards (scryfall_id, name, set_code, collector_number, rarity, quantity, condition, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scryfall_id) DO UPDATE SET
        quantity = quantity + excluded.quantity,
        condition = excluded.condition,
        notes = excluded.notes
    `, [
      scryfallId,
      card.name,
      card.set,
      card.collector_number,
      card.rarity,
      quantity,
      condition,
      notes
    ], function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Failed to add card' });
      }

      res.json({
        id: this.lastID,
        scryfallId,
        name: card.name,
        quantity
      });
    });
  } catch (error) {
    console.error('Error adding card:', error);
    res.status(500).json({ error: 'Failed to add card' });
  }
});

// Update card quantity/condition
router.patch('/:scryfallId', (req, res) => {
  const { scryfallId } = req.params;
  const { quantity, condition, notes } = req.body;

  const updates = [];
  const values = [];

  if (quantity !== undefined) {
    updates.push('quantity = ?');
    values.push(quantity);
  }
  if (condition !== undefined) {
    updates.push('condition = ?');
    values.push(condition);
  }
  if (notes !== undefined) {
    updates.push('notes = ?');
    values.push(notes);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No updates provided' });
  }

  values.push(scryfallId);

  db.run(
    `UPDATE owned_cards SET ${updates.join(', ')} WHERE scryfall_id = ?`,
    values,
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Card not found in collection' });
      }

      res.json({ success: true, updated: this.changes });
    }
  );
});

// Remove card from collection
router.delete('/:scryfallId', (req, res) => {
  const { scryfallId } = req.params;

  db.run('DELETE FROM owned_cards WHERE scryfall_id = ?', [scryfallId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Card not found in collection' });
    }

    res.json({ success: true, deleted: this.changes });
  });
});

module.exports = router;