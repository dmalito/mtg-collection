// Shared logic for collapsing Scryfall printings down to one entry per
// unique art (illustration_id), and for matching "owned" status by art
// rather than by exact printing. Used by catalog.js (which feeds both
// routes/cards.js and routes/stats.js) so the two never drift apart.

const RARITY_ORDER = { common: 0, uncommon: 1, rare: 2, mythic: 3, special: 4, bonus: 5 };

// Every Secret Lair product set on Scryfall. Matched by code, with a
// set-name fallback so a newly added "Secret Lair ..." set is still caught.
const SECRET_LAIR_SETS = new Set(['sld', 'slc', 'slp', 'slu', 'slx', 'slz']);

function isSecretLair(card) {
  return SECRET_LAIR_SETS.has(card.set) || /secret lair/i.test(card.set_name || '');
}

// Double-faced and reversible cards have no top-level illustration_id --
// each face carries its own -- so use the front face's. Without this every
// printing of such a card counted as a separate art and was never deduped.
function artIdOf(card) {
  return card.illustration_id || card.card_faces?.[0]?.illustration_id || null;
}

// Released cards have released_at <= today; Scryfall lists spoiled
// not-yet-released cards with a future date.
function isUpcoming(card, today) {
  return Boolean(card.released_at) && card.released_at > today;
}

// Collapse a list of printings to one card per art, keeping the
// lowest-rarity printing of each. Cards with no art id at all are kept
// as-is. Needs every printing (Scryfall unique=prints) to work: with
// unique=art Scryfall has already picked an arbitrary printing per art,
// so there'd be no lower-rarity one left to prefer.
function dedupeByArt(cards) {
  const seenArt = new Map();
  const deduped = [];

  for (const card of cards) {
    const artId = artIdOf(card);

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
// fall back to the card's own exact id (covers cards with no art id, and
// owned rows that predate the illustration_id column).
function getOwned(card, index) {
  const artId = artIdOf(card);
  if (artId && index.byIllustrationId[artId] !== undefined) {
    return index.byIllustrationId[artId];
  }
  return index.byScryfallId[card.id] || 0;
}

module.exports = {
  RARITY_ORDER,
  SECRET_LAIR_SETS,
  isSecretLair,
  artIdOf,
  isUpcoming,
  dedupeByArt,
  buildOwnedIndex,
  getOwned,
};
