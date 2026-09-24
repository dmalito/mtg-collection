// Scryfall rejects requests with a library-default User-Agent (400
// generic_user_agent), so every call goes through here.
const HEADERS = {
  'User-Agent': 'mtg-collection/1.0',
  Accept: 'application/json',
};

function scryfallFetch(url) {
  return fetch(url, { headers: HEADERS });
}

module.exports = { scryfallFetch };
