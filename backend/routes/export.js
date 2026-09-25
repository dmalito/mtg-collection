const express = require('express');
const router = express.Router();
const db = require('../db');
const { CATEGORIES, buildCatalog, annotateOwned } = require('../catalog');
const { buildChecklistModel, renderChecklistPdf } = require('../checklist');

// PDF checklist of a whole type: every category, split by rarity, owned
// cards ticked. Ignores the on-screen search/ownership filters -- it's the
// full list -- but takes `upcoming=true` like the rest of the API.
router.get('/checklist.pdf', async (req, res) => {
  const { type, upcoming } = req.query;

  if (!type) {
    return res.status(400).json({ error: 'type parameter required' });
  }

  try {
    const owned = await new Promise((resolve, reject) => {
      db.all('SELECT scryfall_id, illustration_id, quantity FROM owned_cards', (err, rows) =>
        err ? reject(err) : resolve(rows)
      );
    });

    const categories = [];
    for (const id of CATEGORIES) {
      const catalog = await buildCatalog({ type, category: id, upcoming: upcoming === 'true' });
      categories.push({ id, cards: annotateOwned(catalog, owned) });
    }

    const generatedAt = new Date().toISOString().slice(0, 10);
    const model = buildChecklistModel({
      type,
      categories,
      upcoming: upcoming === 'true',
      generatedAt,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="mtg-${type.replace(/[^a-z0-9-]/gi, '_')}-checklist-${generatedAt}.pdf"`
    );
    renderChecklistPdf(model, res);
  } catch (error) {
    console.error('Error building checklist:', error);
    if (res.headersSent) {
      return res.end();
    }
    if (error.status) {
      return res.status(error.status).json({ error: 'Scryfall API error' });
    }
    res.status(500).json({ error: 'Failed to build checklist' });
  }
});

module.exports = router;
