const express = require('express');
const router = express.Router();
const db = require('../db');

// Aggregate collection stats, for the shelf hub. Must stay above the
// '/:type' route below -- Express matches in declaration order, and a
// 'summary' route placed after it would be swallowed as a type and trigger
// a live Scryfall search for "t:summary".
router.get('/summary', (req, res) => {
  db.get(
    `SELECT COUNT(*) AS owned, COALESCE(SUM(quantity), 0) AS copies
     FROM owned_cards`,
    (err, totals) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      db.all('SELECT name FROM tracked_types ORDER BY name', (err2, types) => {
        if (err2) {
          return res.status(500).json({ error: 'Database error' });
        }

        db.get(
          `SELECT scryfall_id, name FROM owned_cards
           ORDER BY acquired_at DESC, id DESC LIMIT 1`,
          (err3, card) => {
            if (err3) {
              return res.status(500).json({ error: 'Database error' });
            }
            res.json({
              app: 'mtg-collection',
              count: totals.owned,
              copies: totals.copies,
              types: types.map((t) => t.name),
              // Scryfall serves the image straight off a card id -- nothing
              // image-related is stored locally (see owned_cards above).
              cover: card
                ? `https://api.scryfall.com/cards/${card.scryfall_id}?format=image&version=art_crop`
                : null,
              cover_label: card ? card.name : null,
            });
          }
        );
      });
    }
  );
});

// Get collection stats for a specific type
router.get('/:type', async (req, res) => {
  const { type } = req.params;

  try {
    // Fetch all cards of this type from Scryfall
    const query = `t:${type} game:paper`;
    const scryfallUrl = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=art`;
    
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(scryfallUrl);

    if (!response.ok) {
      return res.status(404).json({ error: 'Type not found or no cards' });
    }

    const data = await response.json();
    const allCards = data.data;

    // Get owned cards
    db.all('SELECT scryfall_id FROM owned_cards', (err, owned) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      const ownedIds = new Set(owned.map(c => c.scryfall_id));

      // Calculate stats by rarity
      const byRarity = {};
      const rarities = ['common', 'uncommon', 'rare', 'mythic'];

      rarities.forEach(rarity => {
        const cardsOfRarity = allCards.filter(c => c.rarity === rarity);
        const ownedOfRarity = cardsOfRarity.filter(c => ownedIds.has(c.id));

        byRarity[rarity] = {
          total: cardsOfRarity.length,
          owned: ownedOfRarity.length,
          percentage: cardsOfRarity.length > 0 
            ? Math.round((ownedOfRarity.length / cardsOfRarity.length) * 100)
            : 0
        };
      });

      res.json({
        type,
        total: allCards.length,
        owned: owned.length,
        percentage: allCards.length > 0
          ? Math.round((owned.length / allCards.length) * 100)
          : 0,
        byRarity
      });
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;