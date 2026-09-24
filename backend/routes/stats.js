const express = require('express');
const router = express.Router();
const db = require('../db');
const { scryfallFetch } = require('../scryfall');
const { dedupeByArt, buildOwnedIndex, getOwned, buildTypeQuery } = require('../artDedupe');

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
  const { includeTokens } = req.query;

  try {
    // Same query builder as /api/cards/search, so the two endpoints can't
    // silently disagree on which cards are in scope for a type.
    const query = buildTypeQuery({ type, includeTokens });
    const scryfallUrl = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=art`;

    const response = await scryfallFetch(scryfallUrl);

    if (!response.ok) {
      return res.status(404).json({ error: 'Type not found or no cards' });
    }

    const data = await response.json();

    // Same dedupe as /api/cards/search -- one entry per unique art
    const dedupedCards = dedupeByArt(data.data);

    // Get owned printings (id, art, quantity)
    db.all('SELECT scryfall_id, illustration_id, quantity FROM owned_cards', (err, owned) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      const ownedIndex = buildOwnedIndex(owned);
      // "Owned" here means "this art is owned" (a presence check), not a
      // summed quantity -- keeps totals counting distinct arts, matching
      // what /api/cards/search's total/owned-count represent.
      const isOwned = card => getOwned(card, ownedIndex) > 0;

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