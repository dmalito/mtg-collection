// Builds the per-type catalog the search and stats routes both read from:
// every printing of a creature type, split into three categories, with
// upcoming (unreleased) cards optionally hidden, deduped to one entry per
// art within each category.
//
//   main        regular printings
//   secretlair  Secret Lair printings, whatever their rarity
//   tokens      token cards
//
// Categories are split *before* dedupe so a Secret Lair printing can't
// swallow -- or be swallowed by -- a regular printing that happens to reuse
// its art; each list is its own collection.

const { scryfallSearchAll } = require('./scryfall');
const { dedupeByArt, isSecretLair, isUpcoming } = require('./artDedupe');

const CATEGORIES = ['main', 'secretlair', 'tokens'];

// Scryfall data barely changes; caching keeps category/rarity clicks from
// re-downloading every page (a full dinosaur fetch is 4+ paged requests).
const TTL_MS = Number(process.env.CATALOG_TTL_MS ?? 10 * 60 * 1000);
const cache = new Map();

function clearCatalogCache() {
  cache.clear();
}

function fetchCached(query) {
  const hit = cache.get(query);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return hit.promise;
  }

  const promise = scryfallSearchAll(query, { unique: 'prints' });
  cache.set(query, { at: Date.now(), promise });
  // Don't keep failures around -- the next request should retry
  promise.catch(() => {
    if (cache.get(query)?.promise === promise) cache.delete(query);
  });
  return promise;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// category: 'main' | 'secretlair' | 'tokens'; upcoming: include unreleased
// cards. Returns:
//   cards          deduped entries for the category (each flagged .upcoming)
//   printingIds    Set of every printing id in the category, so callers can
//                  scope owned matching to it
//   counts         deduped entry count for every category (same upcoming
//                  setting), for the category tabs
//   upcomingCount  entries the upcoming toggle adds to this category
//   hasCards       whether Scryfall knows the type at all (non-token)
async function buildCatalog({ type, category = 'main', upcoming = false }) {
  const nonTokens = await fetchCached(`t:${type} -t:token game:paper`);
  const tokens = await fetchCached(`t:${type} t:token game:paper`);

  const lists = {
    main: nonTokens.filter((card) => !isSecretLair(card)),
    secretlair: nonTokens.filter(isSecretLair),
    tokens,
  };

  const today = todayISO();
  const view = (list, includeUpcoming) =>
    dedupeByArt(includeUpcoming ? list : list.filter((card) => !isUpcoming(card, today)));

  const counts = {};
  for (const name of CATEGORIES) {
    counts[name] = view(lists[name], upcoming).length;
  }

  const selected = lists[category] || lists.main;
  const cards = view(selected, upcoming).map((card) => ({
    ...card,
    upcoming: isUpcoming(card, today),
  }));

  return {
    cards,
    printingIds: new Set(selected.map((card) => card.id)),
    counts,
    upcomingCount: view(selected, true).length - view(selected, false).length,
    hasCards: nonTokens.length > 0,
  };
}

module.exports = { CATEGORIES, buildCatalog, clearCatalogCache };
