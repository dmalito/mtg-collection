const express = require('express');
const router = express.Router();
const db = require('../db');

// Search cards from Scryfall with owned status
router.get('/search', async (req, res) => {
  const { type, rarity, includeTokens } = req.query;

  if (!type) {
    return res.status(400).json({ error: 'type parameter required' });
  }

  try {
    // Build Scryfall query
    let query = `t:${type}`;
    if (rarity) {
      query += ` r:${rarity}`;
    }
    
    // Include or exclude tokens
    if (includeTokens !== 'true') {
      query += ' -t:token';
    }
    
    query += ' game:paper'; // Only paper-legal cards

    const scryfallUrl = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=art`;
    
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(scryfallUrl);

    if (!response.ok) {
      if (response.status === 404) {
        // No cards found
        return res.json({ total: 0, cards: [] });
      }
      return res.status(response.status).json({ error: 'Scryfall API error' });
    }

    const data = await response.json();

    // Deduplicate by illustration_id (handles same art, different rarities)
    const seenArt = new Map();
    const dedupedCards = [];

    for (const card of data.data) {
      const artId = card.illustration_id;
      
      if (!artId) {
        // No art ID, include it anyway
        dedupedCards.push(card);
        continue;
      }

      const existing = seenArt.get(artId);
      
      if (!existing) {
        // First time seeing this art
        seenArt.set(artId, card);
        dedupedCards.push(card);
      } else {
        // We've seen this art before
        // Keep the one with lower rarity (common < uncommon < rare < mythic)
        const rarityOrder = { common: 0, uncommon: 1, rare: 2, mythic: 3, special: 4, bonus: 5 };
        const currentRarity = rarityOrder[card.rarity] || 99;
        const existingRarity = rarityOrder[existing.rarity] || 99;
        
        if (currentRarity < existingRarity) {
          // Replace with lower rarity version
          seenArt.set(artId, card);
          const index = dedupedCards.indexOf(existing);
          if (index !== -1) {
            dedupedCards[index] = card;
          }
        }
        // Otherwise, skip this duplicate
      }
    }

    // Get all owned scryfall IDs
    db.all('SELECT scryfall_id, quantity FROM owned_cards', (err, owned) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      const ownedMap = {};
      owned.forEach(card => {
        ownedMap[card.scryfall_id] = card.quantity;
      });

      // Annotate cards with owned status
      const cards = dedupedCards.map(card => ({
        ...card,
        owned: ownedMap[card.id] || 0
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
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(`https://api.scryfall.com/cards/${scryfallId}`);

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