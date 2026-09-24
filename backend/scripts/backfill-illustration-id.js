// One-off migration: populate illustration_id for owned_cards rows added
// before that column existed, so art-based owned matching (artDedupe.js)
// works for them too. Not run automatically -- run once after deploying
// the illustration_id schema change:
//
//   docker compose exec mtg-collection node scripts/backfill-illustration-id.js
//
// or locally: DATA_DIR=./data node backend/scripts/backfill-illustration-id.js
//
// Until this runs, those rows just fall back to exact scryfall_id matching
// (today's behavior) -- this is a completeness step, not a blocking one.

const db = require('../db');
const { scryfallFetch } = require('../scryfall');

const DELAY_MS = 100; // polite pacing between Scryfall requests

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      err ? reject(err) : resolve(this);
    });
  });
}

async function main() {
  const rows = await all('SELECT id, scryfall_id FROM owned_cards WHERE illustration_id IS NULL');

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const response = await scryfallFetch(`https://api.scryfall.com/cards/${row.scryfall_id}`);
      if (!response.ok) {
        console.warn(`Skipping ${row.scryfall_id}: Scryfall returned ${response.status}`);
        skipped += 1;
      } else {
        const card = await response.json();
        await run('UPDATE owned_cards SET illustration_id = ? WHERE id = ?', [
          card.illustration_id || null,
          row.id
        ]);
        updated += 1;
      }
    } catch (error) {
      console.warn(`Skipping ${row.scryfall_id}: ${error.message}`);
      skipped += 1;
    }

    await sleep(DELAY_MS);
  }

  console.log(`Backfill complete: ${updated} updated, ${skipped} skipped, ${rows.length} total.`);
  db.close();
}

main().catch(error => {
  console.error('Backfill failed:', error);
  db.close();
  process.exitCode = 1;
});
