// The owned cards laid out as a physical-style binder (fixed pockets per page,
// oldest release first), served in the same JSON shape as smart-cataloguer's
// /api/binders/summary and /api/binder/<name> so the shelf hub can show it
// with its generic binder viewer. Read-only.
//
// Lives under routes/ on purpose: the Dockerfile COPYs that directory whole,
// whereas a new top-level backend .js file would need adding to its COPY line.
const express = require('express');
const router = express.Router();
const db = require('../db');
const { scryfallFetch } = require('../scryfall');

// Owned rows carry no per-type column, so this is one binder for the whole
// collection rather than one per tracked type.
const BINDER_NAME = 'MTG Collection';
const COLLECTION_TYPE = 'MTG';
// The app's own accent (active buttons in App.svelte)
const BINDER_COLOR = '#667eea';
const COLS = 3;
const ROWS = 3;
const POCKETS = COLS * ROWS;
// Standard trading card, same default smart-cataloguer uses
const ASPECT_W = 63;
const ASPECT_H = 88;
// Scryfall's /cards/collection takes at most 75 identifiers per request
const COLLECTION_BATCH = 75;

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      err ? reject(err) : resolve(this);
    });
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fill in released_at for owned rows that predate the column, in batches
// from Scryfall, and persist it. Best effort: on any failure the undated
// rows just sort last. One run at a time, so concurrent shelf loads share it.
let backfillInFlight = null;

async function fillReleaseDates(rows) {
  const undated = rows.filter((row) => !row.released_at);
  if (!undated.length) return;

  const delay = Number(process.env.SCRYFALL_DELAY_MS ?? 100);
  const byId = new Map(undated.map((row) => [row.scryfall_id, row]));

  for (let i = 0; i < undated.length; i += COLLECTION_BATCH) {
    const batch = undated.slice(i, i + COLLECTION_BATCH);
    const response = await scryfallFetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: batch.map((row) => ({ id: row.scryfall_id })) }),
    });
    if (!response.ok) {
      throw new Error(`Scryfall /cards/collection returned ${response.status}`);
    }
    const { data = [] } = await response.json();
    for (const card of data) {
      const row = byId.get(card.id);
      if (row && card.released_at) {
        row.released_at = card.released_at;
        await run('UPDATE owned_cards SET released_at = ? WHERE scryfall_id = ?', [
          card.released_at,
          card.id,
        ]);
      }
    }
    if (delay > 0 && i + COLLECTION_BATCH < undated.length) await sleep(delay);
  }
}

async function ensureReleaseDates(rows) {
  if (!rows.some((row) => !row.released_at)) return;
  if (!backfillInFlight) {
    backfillInFlight = fillReleaseDates(rows)
      .catch((error) => console.warn('Could not backfill release dates:', error.message))
      .finally(() => {
        backfillInFlight = null;
      });
  }
  await backfillInFlight;
}

const collectorNumber = (row) => parseInt(row.collector_number, 10) || 0;

// Oldest release first, undated cards last, then collector number so a set's
// cards keep their printed order.
function byRelease(a, b) {
  if (!a.released_at !== !b.released_at) return a.released_at ? -1 : 1;
  return (
    (a.released_at || '').localeCompare(b.released_at || '') ||
    collectorNumber(a) - collectorNumber(b) ||
    a.name.localeCompare(b.name) ||
    a.id - b.id
  );
}

function cardJson(row) {
  return {
    id: row.scryfall_id,
    name: row.name,
    set: row.set_code.toUpperCase(),
    number: row.collector_number,
    condition: row.condition || null,
    notes: row.quantity > 1 ? `${row.quantity} copies` : null,
    flag: null,
    // Nothing image-related is stored locally; Scryfall serves the picture
    // straight off the card id. Absolute, unlike smart-cataloguer's
    // app-relative paths -- the shelf handles both.
    image: `https://api.scryfall.com/cards/${row.scryfall_id}?format=image&version=normal`,
  };
}

router.get('/binders/summary', async (req, res) => {
  try {
    const [{ count }] = await all('SELECT COUNT(*) AS count FROM owned_cards');
    res.json({
      binders: [
        {
          name: BINDER_NAME,
          cards: count,
          pages: Math.ceil(count / POCKETS),
          collection_type: COLLECTION_TYPE,
          color: BINDER_COLOR,
          link: '/',
        },
      ],
    });
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/binder/:name', async (req, res) => {
  if (req.params.name !== BINDER_NAME) {
    return res.status(404).json({ error: 'unknown binder' });
  }

  try {
    const rows = await all('SELECT * FROM owned_cards');
    await ensureReleaseDates(rows);
    rows.sort(byRelease);

    const pages = [];
    for (let i = 0; i < rows.length; i += POCKETS) {
      const cards = rows.slice(i, i + POCKETS).map(cardJson);
      // Pad the last page with empty pockets, like a real binder page
      while (cards.length < POCKETS) cards.push(null);
      pages.push({ page: pages.length + 1, cols: COLS, cards });
    }

    res.json({
      name: BINDER_NAME,
      collection_type: COLLECTION_TYPE,
      color: BINDER_COLOR,
      aspect_w: ASPECT_W,
      aspect_h: ASPECT_H,
      pages,
      link: '/',
    });
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
