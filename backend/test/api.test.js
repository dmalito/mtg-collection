const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Must be set before ./db is first required
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtg-test-'));
process.env.DATA_DIR = dataDir;

const app = require('../server');
const db = require('../db');

// The routes call the global fetch for Scryfall; the tests call it for the
// app under test. Keep the real one for the latter and stub only Scryfall.
const realFetch = globalThis.fetch;
let scryfall = () => ({ status: 404, body: {} });
let scryfallHeaders = [];
let server;
let base;

function stubScryfall(handler) {
  scryfall = handler;
}

before(async () => {
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.scryfall.com')) {
      scryfallHeaders.push(opts && opts.headers);
      const { status, body } = scryfall(String(url));
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    }
    return realFetch(url, opts);
  };
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  globalThis.fetch = realFetch;
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => db.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await new Promise((resolve) => db.run('DELETE FROM owned_cards', resolve));
  await new Promise((resolve) => db.run("DELETE FROM tracked_types WHERE name != 'dinosaur'", resolve));
});

async function call(method, url, body) {
  const res = await realFetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const card = (over = {}) => ({
  id: 'id-1',
  name: 'Test Dino',
  set: 'xln',
  collector_number: '1',
  rarity: 'common',
  illustration_id: 'art-1',
  ...over,
});

test('health check', async () => {
  const { status, body } = await call('GET', '/api/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
});

test('db is created inside DATA_DIR', () => {
  assert.ok(fs.existsSync(path.join(dataDir, 'mtg.db')));
});

test('types: dinosaur is seeded; add, duplicate, delete', async () => {
  let r = await call('GET', '/api/types');
  assert.deepEqual(r.body.map((t) => t.name), ['dinosaur']);

  r = await call('POST', '/api/types', { name: 'Dragon' });
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'dragon');

  r = await call('POST', '/api/types', { name: 'dragon' });
  assert.equal(r.status, 409);

  r = await call('POST', '/api/types', {});
  assert.equal(r.status, 400);

  r = await call('DELETE', '/api/types/dragon');
  assert.equal(r.status, 200);
  r = await call('DELETE', '/api/types/dragon');
  assert.equal(r.status, 404);
});

test('collection: add, re-add sums quantity, patch, delete', async () => {
  stubScryfall(() => ({ status: 200, body: card() }));

  let r = await call('POST', '/api/collection', { scryfallId: 'id-1', quantity: 2 });
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'Test Dino');

  await call('POST', '/api/collection', { scryfallId: 'id-1', quantity: 3 });
  r = await call('GET', '/api/collection');
  assert.equal(r.body.length, 1);
  assert.equal(r.body[0].quantity, 5);

  r = await call('PATCH', '/api/collection/id-1', { quantity: 1, condition: 'LP' });
  assert.equal(r.status, 200);
  r = await call('GET', '/api/collection');
  assert.equal(r.body[0].quantity, 1);
  assert.equal(r.body[0].condition, 'LP');

  r = await call('PATCH', '/api/collection/id-1', {});
  assert.equal(r.status, 400);
  r = await call('PATCH', '/api/collection/nope', { quantity: 1 });
  assert.equal(r.status, 404);

  r = await call('DELETE', '/api/collection/id-1');
  assert.equal(r.status, 200);
  r = await call('DELETE', '/api/collection/id-1');
  assert.equal(r.status, 404);
});

test('collection: rejects missing id and unknown Scryfall card', async () => {
  let r = await call('POST', '/api/collection', {});
  assert.equal(r.status, 400);

  stubScryfall(() => ({ status: 404, body: {} }));
  r = await call('POST', '/api/collection', { scryfallId: 'ghost' });
  assert.equal(r.status, 404);
});

test('cards/search: requires type, treats Scryfall 404 as empty', async () => {
  let r = await call('GET', '/api/cards/search');
  assert.equal(r.status, 400);

  stubScryfall(() => ({ status: 404, body: {} }));
  r = await call('GET', '/api/cards/search?type=dinosaur');
  assert.deepEqual(r.body, { total: 0, cards: [] });
});

test('cards/search: builds the Scryfall query from filters', async () => {
  let seen;
  stubScryfall((url) => {
    seen = decodeURIComponent(new URL(url).searchParams.get('q'));
    return { status: 200, body: { data: [] } };
  });

  await call('GET', '/api/cards/search?type=dragon&rarity=rare');
  assert.equal(seen, 't:dragon r:rare -t:token game:paper');

  await call('GET', '/api/cards/search?type=dragon&includeTokens=true');
  assert.equal(seen, 't:dragon game:paper');
});

test('cards/search: dedupes same art keeping lowest rarity, annotates owned', async () => {
  stubScryfall((url) => {
    if (url.includes('/cards/search')) {
      return {
        status: 200,
        body: {
          data: [
            card({ id: 'a-rare', rarity: 'rare', illustration_id: 'art-A' }),
            card({ id: 'a-common', rarity: 'common', illustration_id: 'art-A' }),
            card({ id: 'b', rarity: 'uncommon', illustration_id: 'art-B' }),
            card({ id: 'c', illustration_id: undefined }),
          ],
        },
      };
    }
    return { status: 200, body: card({ id: 'b' }) };
  });
  await call('POST', '/api/collection', { scryfallId: 'b', quantity: 2 });

  const r = await call('GET', '/api/cards/search?type=dinosaur');
  assert.equal(r.body.total, 3);
  assert.deepEqual(r.body.cards.map((c) => c.id).sort(), ['a-common', 'b', 'c']);
  assert.equal(r.body.cards.find((c) => c.id === 'b').owned, 2);
  assert.equal(r.body.cards.find((c) => c.id === 'a-common').owned, 0);
});

test('cards/:id: 404 from Scryfall, and owned count on hit', async () => {
  stubScryfall(() => ({ status: 404, body: {} }));
  let r = await call('GET', '/api/cards/ghost');
  assert.equal(r.status, 404);

  stubScryfall(() => ({ status: 200, body: card() }));
  await call('POST', '/api/collection', { scryfallId: 'id-1', quantity: 4 });
  r = await call('GET', '/api/cards/id-1');
  assert.equal(r.body.owned, 4);
});

test('stats/summary is not swallowed by /:type and never hits Scryfall', async () => {
  stubScryfall(() => {
    throw new Error('summary must not call Scryfall');
  });

  let r = await call('GET', '/api/stats/summary');
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 0);
  assert.equal(r.body.cover, null);
  assert.deepEqual(r.body.types, ['dinosaur']);

  stubScryfall(() => ({ status: 200, body: card() }));
  await call('POST', '/api/collection', { scryfallId: 'id-1', quantity: 3 });
  r = await call('GET', '/api/stats/summary');
  assert.equal(r.body.count, 1);
  assert.equal(r.body.copies, 3);
  assert.match(r.body.cover, /cards\/id-1\?format=image/);
  assert.equal(r.body.cover_label, 'Test Dino');
});

test('stats/:type: percentages by rarity', async () => {
  stubScryfall((url) =>
    url.includes('/cards/search')
      ? {
          status: 200,
          body: {
            data: [
              card({ id: 'x1', rarity: 'common' }),
              card({ id: 'x2', rarity: 'common' }),
              card({ id: 'x3', rarity: 'rare' }),
              card({ id: 'x4', rarity: 'rare' }),
            ],
          },
        }
      : { status: 200, body: card({ id: 'x1' }) }
  );
  await call('POST', '/api/collection', { scryfallId: 'x1' });

  const r = await call('GET', '/api/stats/dinosaur');
  assert.equal(r.body.total, 4);
  assert.equal(r.body.owned, 1);
  assert.equal(r.body.percentage, 25);
  assert.equal(r.body.byRarity.common.percentage, 50);
  assert.equal(r.body.byRarity.rare.percentage, 0);
});

test('every Scryfall request sends a custom User-Agent and Accept header', async () => {
  scryfallHeaders = [];
  stubScryfall((url) => ({
    status: 200,
    body: url.includes('/cards/search') ? { data: [card()] } : card(),
  }));

  await call('GET', '/api/cards/search?type=dinosaur');
  await call('GET', '/api/cards/id-1');
  await call('GET', '/api/stats/dinosaur');
  await call('POST', '/api/collection', { scryfallId: 'id-1' });

  assert.equal(scryfallHeaders.length, 4);
  for (const h of scryfallHeaders) {
    assert.equal(h['User-Agent'], 'mtg-collection/1.0');
    assert.equal(h.Accept, 'application/json');
  }
});
