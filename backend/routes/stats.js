const express = require('express');
const router = express.Router();
const db = require('../db');
const { scryfallFetch } = require('../scryfall');
const { CATEGORIES, buildCatalog, annotateOwned } = require('../catalog');

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

// Get collection stats for a specific type. Takes the same category and
// upcoming params as /api/cards/search, so its numbers match what that list
// shows (defaults: main category, released cards only).
router.get('/:type', async (req, res) => {
  const { type } = req.params;
  const { category = 'main', upcoming } = req.query;

  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `category must be one of: ${CATEGORIES.join(', ')}` });
  }

  try {
    const catalog = await buildCatalog({ type, category, upcoming: upcoming === 'true' });

    if (!catalog.hasCards) {
      return res.status(404).json({ error: 'Type not found or no cards' });
    }

    // Get owned printings (id, art, quantity)
    db.all('SELECT scryfall_id, illustration_id, quantity FROM owned_cards', (err, owned) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      // "Owned" here means "this art is owned" (a presence check, not a
      // summed quantity) -- keeps totals counting distinct arts, matching
      // what /api/cards/search's total/owned-count represent.
      const dedupedCards = annotateOwned(catalog, owned);
      const isOwned = card => card.owned > 0;

      // Calculate stats by rarity
      const byRarity = {};
      const rarities = ['common', 'uncommon', 'rare', 'mythic'];

      rarities.forEach(rarity => {
        const cardsOfRarity = dedupedCards.filter(c => c.rarity === rarity);
        const ownedOfRarity = cardsOfRarity.filter(isOwned);

        byRarity[rarity] = {
          total: cardsOfRarity.length,
          owned: ownedOfRarity.length,
          percentage: cardsOfRarity.length > 0 
            ? Math.round((ownedOfRarity.length / cardsOfRarity.length) * 100)
            : 0
        };
      });

      const ownedCount = dedupedCards.filter(isOwned).length;

      res.json({
        type,
        category,
        total: dedupedCards.length,
        owned: ownedCount,
        percentage: dedupedCards.length > 0
          ? Math.round((ownedCount / dedupedCards.length) * 100)
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