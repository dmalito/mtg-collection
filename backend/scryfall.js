// Scryfall rejects requests with a library-default User-Agent (400
// generic_user_agent), so every call goes through here.
const HEADERS = {
  'User-Agent': 'mtg-collection/1.0',
  Accept: 'application/json',
};

// Scryfall asks for 50-100ms between requests
const PAGE_DELAY_MS = Number(process.env.SCRYFALL_DELAY_MS ?? 100);

function scryfallFetch(url) {
  return fetch(url, { headers: HEADERS });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Run a card search and follow next_page until every result is in. A search
// returns at most 175 cards per page, so reading only the first page
// silently drops the rest. A 404 means "no cards matched" -> []. Any other
// failure throws, with .status set to Scryfall's status code.
async function scryfallSearchAll(query, { unique = 'prints' } = {}) {
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=${unique}`;
  const cards = [];

  while (url) {
    const response = await scryfallFetch(url);

    if (response.status === 404) {
      return cards;
    }
    if (!response.ok) {
      const error = new Error(`Scryfall API error (${response.status})`);
      error.status = response.status;
      throw error;
    }

    const page = await response.json();
    cards.push(...page.data);
    url = page.has_more ? page.next_page : null;

    if (url && PAGE_DELAY_MS > 0) {
      await sleep(PAGE_DELAY_MS);
    }
  }

  return cards;
}

module.exports = { scryfallFetch, scryfallSearchAll };
