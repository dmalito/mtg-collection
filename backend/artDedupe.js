// Shared logic for collapsing Scryfall search results down to one entry per
// unique art (illustration_id), and for matching "owned" status by art
// rather than by exact printing. Used by both routes/cards.js and
// routes/stats.js so the two never drift apart on how they count.

const RARITY_ORDER = { common: 0, uncommon: 1, rare: 2, mythic: 3, special: 4, bonus: 5 };

// Collapse a raw Scryfall card list to one card per illustration_id,
// keeping the lowest-rarity printing of each art. Cards with no
// illustration_id (some layouts don't have one) are always kept as-is.
function dedupeByArt(cards) {
  const seenArt = new Map();
  const deduped = [];

  for (const card of cards) {
    const artId = card.illustration_id;

    if (!artId) {
      deduped.push(card);
      continue;
    }

    const existing = seenArt.get(artId);

    if (!existing) {
      seenArt.set(artId, card);
      deduped.push(card);
    } else {
      const currentRarity = RARITY_ORDER[card.rarity] ?? 99;
      const existingRarity = RARITY_ORDER[existing.rarity] ?? 99;

      if (currentRarity < existingRarity) {
        seenArt.set(artId, card);
        const index = deduped.indexOf(existing);
        if (index !== -1) {
          deduped[index] = card;
        }
      }
    }
  }

  return deduped;
}

// Build a lookup from owned_cards rows (scryfall_id, illustration_id,
// quantity) into two maps of summed quantity: by exact printing, and by
// art. Rows with no illustration_id are skipped in the art map.
function buildOwnedIndex(ownedRows) {
  const byScryfallId = {};
  const byIllustrationId = {};

  for (const row of ownedRows) {
    byScryfallId[row.scryfall_id] = (byScryfallId[row.scryfall_id] || 0) + row.quantity;

    if (row.illustration_id) {
      byIllustrationId[row.illustration_id] =
        (byIllustrationId[row.illustration_id] || 0) + row.quantity;
    }
  }

  return { byScryfallId, byIllustrationId };
}

// Owned quantity for a (post-dedupe) representative card: prefer matching
// by art -- so owning any reprint of the same illustration counts -- and
// fall back to the card's own exact id (covers cards with no
// illustration_id, and owned rows that predate the illustration_id column).
function getOwned(card, index) {
  if (card.illustration_id && index.byIllustrationId[card.illustration_id] !== undefined) {
    return index.byIllustrationId[card.illustration_id];
  }
  return index.byScryfallId[card.id] || 0;
}

// Shared Scryfall query builder. rarity is deliberately never part of this
// -- it's applied client-side, after dedupe, to the surviving cards' own
// rarity (see routes/cards.js) so a rarity filter can't hide dedupe's view
// of a lower-rarity printing of the same art.
function buildTypeQuery({ type, includeTokens }) {
  let query = `t:${type}`;
  if (includeTokens !== 'true') {
    query += ' -t:token';
  }
  query += ' game:paper';
  return query;
}

module.exports = { RARITY_ORDER, dedupeByArt, buildOwnedIndex, getOwned, buildTypeQuery };
