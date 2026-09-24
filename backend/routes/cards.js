const express = require('express');
const router = express.Router();
const db = require('../db');
const { scryfallFetch } = require('../scryfall');
const { dedupeByArt, buildOwnedIndex, getOwned, buildTypeQuery } = require('../artDedupe');

// Search cards from Scryfall with owned status
router.get('/search', async (req, res) => {
  const { type, rarity, includeTokens } = req.query;

  if (!type) {
    return res.status(400).json({ error: 'type parameter required' });
  }

  try {
    // rarity is deliberately not sent to Scryfall -- dedupe needs to see
    // every rarity of an art to know which printing is the lowest, so
    // rarity is applied as a filter after dedupe, below.
    const query = buildTypeQuery({ type, includeTokens });
    const scryfallUrl = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=art`;

    const response = await scryfallFetch(scryfallUrl);

    if (!response.ok) {
      if (response.status === 404) {
        // No cards found
        return res.json({ total: 0, cards: [] });
      }
      return res.status(response.status).json({ error: 'Scryfall API error' });
    }

    const data = await response.json();

    // One entry per unique art, keeping the lowest-rarity printing
    const dedupedCards = dedupeByArt(data.data);

    // A rarity filter now means "this art's cheapest printing is this
    // rarity" -- applied to the deduped survivors, not to Scryfall's query.
    const filteredCards = rarity
      ? dedupedCards.filter(card => card.rarity === rarity)
      : dedupedCards;

    // Get all owned printings (id, art, quantity)
    db.all('SELECT scryfall_id, illustration_id, quantity FROM owned_cards', (err, owned) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      const ownedIndex = buildOwnedIndex(owned);

      // Annotate cards with owned status -- matched by art, so owning any
      // reprint of the same illustration credits the surviving entry.
      const cards = filteredCards.map(card => ({
        ...card,
        owned: getOwned(card, ownedIndex)
      }));

      res.json({
        total: cards.length,
        cards: cards
      });
    });
  } catch (error) {
    console.error('Error fetching from Scryfall:', error);
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