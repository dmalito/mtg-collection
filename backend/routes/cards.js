const express = require('express');
const router = express.Router();
const db = require('../db');
const { scryfallFetch } = require('../scryfall');
const { buildOwnedIndex, getOwned } = require('../artDedupe');
const { CATEGORIES, buildCatalog } = require('../catalog');

// Search cards from Scryfall with owned status.
//   type      creature type (required)
//   category  main (default) | secretlair | tokens
//   upcoming  'true' to include not-yet-released cards (hidden by default)
//   rarity    optional; filters the deduped entries to those whose own
//             (lowest-rarity) printing has this rarity
router.get('/search', async (req, res) => {
  const { type, rarity, category = 'main', upcoming } = req.query;

  if (!type) {
    return res.status(400).json({ error: 'type parameter required' });
  }
  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `category must be one of: ${CATEGORIES.join(', ')}` });
  }

  try {
    const catalog = await buildCatalog({ type, category, upcoming: upcoming === 'true' });

    // rarity is applied after dedupe (which needs to see every rarity of an
    // art to pick the lowest), so it means "this art's cheapest printing is
    // this rarity".
    const filteredCards = rarity
      ? catalog.cards.filter(card => card.rarity === rarity)
      : catalog.cards;

    // Get all owned printings (id, art, quantity)
    db.all('SELECT scryfall_id, illustration_id, quantity FROM owned_cards', (err, owned) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      // Only printings in this category count, so owning the regular
      // printing of an art doesn't mark its Secret Lair twin as owned.
      const ownedIndex = buildOwnedIndex(owned.filter(row => catalog.printingIds.has(row.scryfall_id)));

      // Owned status is matched by art, so owning any reprint of the same
      // illustration credits the surviving entry.
      const cards = filteredCards.map(card => ({
        ...card,
        owned: getOwned(card, ownedIndex)
      }));

      res.json({
        total: cards.length,
        cards,
        category,
        counts: catalog.counts,
        upcomingCount: catalog.upcomingCount
      });
    });
  } catch (error) {
    console.error('Error fetching from Scryfall:', error);
    if (error.status) {
      return res.status(error.status).json({ error: 'Scryfall API error' });
    }
    res.status(500).json({ error: 'Failed to fetch cards' });
  }
});

// Get single card details
router.get('/:scryfallId', async (req, res) => {
  const { scryfallId } = req.params;

  try {
    const response = await scryfallFetch(`https://api.scryfall.com/cards/${scryfallId}`);

    if (!response.ok) {
      return res.status(404).json({ error: 'Card not found' });
    }

    const card = await response.json();

    db.get('SELECT quantity FROM owned_cards WHERE scryfall_id = ?', [scryfallId], (err, owned) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      res.json({
        ...card,
        owned: owned ? owned.quantity : 0
      });
    });
  } catch (error) {
    console.error('Error fetching card:', error);
    res.status(500).json({ error: 'Failed to fetch card' });
  }
});

module.exports = router;