const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Must be set before ./db / ./scryfall are first required
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtg-test-'));
process.env.DATA_DIR = dataDir;
process.env.SCRYFALL_DELAY_MS = '0';

const app = require('../server');
const db = require('../db');
const { clearCatalogCache } = require('../catalog');

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
  clearCatalogCache();
  scryfallHeaders = [];
  await new Promise((resolve) => db.run('DELETE FROM owned_cards', resolve));
  await new Promise((resolve) => db.run("DELETE FROM tracked_types WHERE name != 'dinosaur'", resolve));
});

function dbGet(sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

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
  released_at: '2020-01-01',
  ...over,
});

const FUTURE = '2999-01-01';

const queryOf = (url) => decodeURIComponent(new URL(url).searchParams.get('q'));

// Stub Scryfall: `main` printings answer the non-token search, `tokens` the
// token search, and any other URL (a single-card lookup) gets `single`.
// Both search bodies can be overridden per-URL via `pages` for paging tests.
function stubCatalog({ main = [], tokens = [], single } = {}) {
  stubScryfall((url) => {
    if (url.includes('/cards/search')) {
      const isMain = queryOf(url).includes('-t:token');
      return { status: 200, body: { data: isMain ? main : tokens } };
    }
    return { status: 200, body: single ?? card() };
  });
}

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

  // illustration_id (the art-based-owned-matching migration column) is
  // stored on insert.
  let row = await dbGet('SELECT illustration_id FROM owned_cards WHERE scryfall_id = ?', ['id-1']);
  assert.equal(row.illustration_id, 'art-1');

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

test('cards/search: requires type, validates category, treats Scryfall 404 as empty', async () => {
  let r = await call('GET', '/api/cards/search');
  assert.equal(r.status, 400);

  r = await call('GET', '/api/cards/search?type=dinosaur&category=nope');
  assert.equal(r.status, 400);

  stubScryfall(() => ({ status: 404, body: {} }));
  r = await call('GET', '/api/cards/search?type=dinosaur');
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 0);
  assert.deepEqual(r.body.cards, []);
});

test('cards/search: passes Scryfall errors through', async () => {
  stubScryfall(() => ({ status: 503, body: {} }));
  const r = await call('GET', '/api/cards/search?type=dinosaur');
  assert.equal(r.status, 503);
});

test('cards/search: asks Scryfall for every printing, never sends rarity', async () => {
  const seen = [];
  stubScryfall((url) => {
    seen.push({ q: queryOf(url), unique: new URL(url).searchParams.get('unique') });
    return { status: 200, body: { data: [] } };
  });

  // rarity is applied after dedupe, never sent to Scryfall -- dedupe needs
  // to see every rarity of an art to keep the lowest. unique=prints (not
  // art) for the same reason: unique=art makes Scryfall pick one arbitrary
  // printing per art before we ever see the others.
  await call('GET', '/api/cards/search?type=dragon&rarity=rare');
  assert.deepEqual(seen, [
    { q: 't:dragon -t:token game:paper', unique: 'prints' },
    { q: 't:dragon t:token game:paper', unique: 'prints' },
  ]);
});

test('cards/search: follows next_page so results past the first 175 are not dropped', async () => {
  stubScryfall((url) => {
    if (url.includes('page=2')) {
      return { status: 200, body: { data: [card({ id: 'p2', illustration_id: 'art-2' })] } };
    }
    if (queryOf(url).includes('-t:token')) {
      return {
        status: 200,
        body: {
          data: [card({ id: 'p1', illustration_id: 'art-1' })],
          has_more: true,
          next_page: url + '&page=2',
        },
      };
    }
    return { status: 200, body: { data: [] } };
  });

  const r = await call('GET', '/api/cards/search?type=dinosaur');
  assert.deepEqual(r.body.cards.map((c) => c.id).sort(), ['p1', 'p2']);
});

test('cards/search: dedupes same art keeping lowest rarity, annotates owned by art', async () => {
  stubCatalog({
    main: [
      card({ id: 'a-rare', rarity: 'rare', illustration_id: 'art-A' }),
      card({ id: 'a-common', rarity: 'common', illustration_id: 'art-A' }),
      card({ id: 'b', rarity: 'uncommon', illustration_id: 'art-B' }),
      card({ id: 'c', illustration_id: undefined }),
    ],
    single: card({ id: 'a-rare', rarity: 'rare', illustration_id: 'art-A' }),
  });
  // Own the *rare* printing of art-A -- the *common* printing is what
  // survives dedupe, so this only proves anything if owned status is
  // matched by art rather than by the surviving printing's exact id.
  await call('POST', '/api/collection', { scryfallId: 'a-rare', quantity: 2 });

  const r = await call('GET', '/api/cards/search?type=dinosaur');
  assert.equal(r.body.total, 3);
  assert.deepEqual(r.body.cards.map((c) => c.id).sort(), ['a-common', 'b', 'c']);
  assert.equal(r.body.cards.find((c) => c.id === 'a-common').owned, 2);
  assert.equal(r.body.cards.find((c) => c.id === 'b').owned, 0);
});

test('cards/search: rarity filter applies after dedupe, to the representative rarity', async () => {
  stubCatalog({
    main: [
      card({ id: 'a-rare', rarity: 'rare', illustration_id: 'art-A' }),
      card({ id: 'a-common', rarity: 'common', illustration_id: 'art-A' }),
      card({ id: 'b', rarity: 'common', illustration_id: 'art-B' }),
    ],
  });

  // art-A's cheapest printing is common, so it survives dedupe as
  // 'a-common' -- a rare filter must not surface it just because a rare
  // printing of that art also exists.
  let r = await call('GET', '/api/cards/search?type=dinosaur&rarity=rare');
  assert.deepEqual(r.body.cards.map((c) => c.id), []);

  r = await call('GET', '/api/cards/search?type=dinosaur&rarity=common');
  assert.deepEqual(r.body.cards.map((c) => c.id).sort(), ['a-common', 'b']);
});

test('cards/search: double-faced cards dedupe by front-face art', async () => {
  const dfc = (over) =>
    card({
      illustration_id: undefined,
      card_faces: [{ illustration_id: 'face-art' }, { illustration_id: 'back-art' }],
      ...over,
    });
  stubCatalog({ main: [dfc({ id: 'dfc-rare', rarity: 'rare' }), dfc({ id: 'dfc-common', rarity: 'common' })] });

  const r = await call('GET', '/api/cards/search?type=dinosaur');
  assert.deepEqual(r.body.cards.map((c) => c.id), ['dfc-common']);
});

test('cards/search: secret lairs and tokens are separate categories, regardless of rarity', async () => {
  stubCatalog({
    main: [
      card({ id: 'reg-common', rarity: 'common', illustration_id: 'art-1', set: 'xln', set_name: 'Ixalan' }),
      card({ id: 'sld-rare', rarity: 'rare', illustration_id: 'art-2', set: 'sld', set_name: 'Secret Lair Drop' }),
      card({ id: 'sld-common', rarity: 'common', illustration_id: 'art-3', set: 'slz', set_name: 'The Zeta Set' }),
      // Same art as a regular printing -- must appear in *both* lists
      card({ id: 'sld-shared', rarity: 'mythic', illustration_id: 'art-1', set: 'sld', set_name: 'Secret Lair Drop' }),
    ],
    tokens: [card({ id: 'tok', rarity: 'common', illustration_id: 'art-tok', set: 'tmom', set_name: 'MOM Tokens' })],
  });

  const ids = async (category) =>
    (await call('GET', `/api/cards/search?type=dinosaur&category=${category}`)).body.cards.map((c) => c.id).sort();

  assert.deepEqual(await ids('main'), ['reg-common']);
  assert.deepEqual(await ids('secretlair'), ['sld-common', 'sld-rare', 'sld-shared']);
  assert.deepEqual(await ids('tokens'), ['tok']);

  // Counts for the tabs come back with every response
  const r = await call('GET', '/api/cards/search?type=dinosaur&category=secretlair');
  assert.deepEqual(r.body.counts, { main: 1, secretlair: 3, tokens: 1 });
  assert.equal(r.body.category, 'secretlair');
});

test('cards/search: owned status is scoped to the category', async () => {
  stubCatalog({
    main: [
      card({ id: 'reg', illustration_id: 'shared-art', set: 'xln' }),
      card({ id: 'sld', illustration_id: 'shared-art', set: 'sld', rarity: 'rare' }),
    ],
    single: card({ id: 'reg', illustration_id: 'shared-art', set: 'xln' }),
  });
  await call('POST', '/api/collection', { scryfallId: 'reg' });

  // Owning the regular printing must not mark its Secret Lair twin owned
  let r = await call('GET', '/api/cards/search?type=dinosaur&category=main');
  assert.equal(r.body.cards[0].owned, 1);
  r = await call('GET', '/api/cards/search?type=dinosaur&category=secretlair');
  assert.equal(r.body.cards[0].owned, 0);
});

test('cards/search: upcoming cards are hidden by default and shown on request', async () => {
  stubCatalog({
    main: [
      card({ id: 'released', illustration_id: 'art-1' }),
      card({ id: 'soon', illustration_id: 'art-2', released_at: FUTURE }),
    ],
  });

  let r = await call('GET', '/api/cards/search?type=dinosaur');
  assert.deepEqual(r.body.cards.map((c) => c.id), ['released']);
  assert.equal(r.body.upcomingCount, 1);
  assert.equal(r.body.counts.main, 1);

  r = await call('GET', '/api/cards/search?type=dinosaur&upcoming=true');
  assert.deepEqual(r.body.cards.map((c) => c.id).sort(), ['released', 'soon']);
  assert.equal(r.body.cards.find((c) => c.id === 'soon').upcoming, true);
  assert.equal(r.body.cards.find((c) => c.id === 'released').upcoming, false);
  assert.equal(r.body.counts.main, 2);
});

test('cards/search: a hidden upcoming printing does not win the dedupe', async () => {
  stubCatalog({
    main: [
      card({ id: 'old-rare', rarity: 'rare', illustration_id: 'art-A' }),
      card({ id: 'new-common', rarity: 'common', illustration_id: 'art-A', released_at: FUTURE }),
    ],
  });

  // Not out yet -> the released rare printing is the entry
  let r = await call('GET', '/api/cards/search?type=dinosaur');
  assert.deepEqual(r.body.cards.map((c) => c.id), ['old-rare']);

  // With upcoming shown, the (cheaper) upcoming printing takes over
  r = await call('GET', '/api/cards/search?type=dinosaur&upcoming=true');
  assert.deepEqual(r.body.cards.map((c) => c.id), ['new-common']);
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
  stubCatalog({
    main: [
      // Distinct illustration_ids -- 4 independent arts, so dedupe is a no-op
      card({ id: 'x1', rarity: 'common', illustration_id: 'art-x1' }),
      card({ id: 'x2', rarity: 'common', illustration_id: 'art-x2' }),
      card({ id: 'x3', rarity: 'rare', illustration_id: 'art-x3' }),
      card({ id: 'x4', rarity: 'rare', illustration_id: 'art-x4' }),
    ],
    single: card({ id: 'x1', illustration_id: 'art-x1' }),
  });
  await call('POST', '/api/collection', { scryfallId: 'x1' });

  const r = await call('GET', '/api/stats/dinosaur');
  assert.equal(r.body.total, 4);
  assert.equal(r.body.owned, 1);
  assert.equal(r.body.percentage, 25);
  assert.equal(r.body.byRarity.common.percentage, 50);
  assert.equal(r.body.byRarity.rare.percentage, 0);
});

test('stats/:type: uses shared dedupe, art-based owned matching, and the same category/upcoming scope as search', async () => {
  stubCatalog({
    main: [
      card({ id: 'a-rare', rarity: 'rare', illustration_id: 'art-A' }),
      card({ id: 'a-common', rarity: 'common', illustration_id: 'art-A' }),
      card({ id: 'x1', rarity: 'common', illustration_id: 'art-x1' }),
      card({ id: 'x2', rarity: 'rare', illustration_id: 'art-x2' }),
      card({ id: 'soon', rarity: 'rare', illustration_id: 'art-soon', released_at: FUTURE }),
      card({ id: 'sld', rarity: 'rare', illustration_id: 'art-sld', set: 'sld' }),
    ],
    single: card({ id: 'a-rare', rarity: 'rare', illustration_id: 'art-A' }),
  });
  // Own only the rare printing of art-A -- the common printing (a-common)
  // is the deduped survivor, and should get the owned credit.
  await call('POST', '/api/collection', { scryfallId: 'a-rare', quantity: 1 });

  let r = await call('GET', '/api/stats/dinosaur');
  // Main category, released only: 3 distinct arts (art-A survives as common)
  assert.equal(r.body.total, 3);
  assert.equal(r.body.byRarity.common.total, 2); // a-common, x1
  assert.equal(r.body.byRarity.common.owned, 1); // a-common, via the rare printing owned
  assert.equal(r.body.byRarity.rare.total, 1); // x2 only -- a-rare lost dedupe to a-common
  assert.equal(r.body.byRarity.rare.owned, 0); // credit landed on common, not double-counted here

  r = await call('GET', '/api/stats/dinosaur?upcoming=true');
  assert.equal(r.body.total, 4);

  r = await call('GET', '/api/stats/dinosaur?category=secretlair');
  assert.equal(r.body.total, 1);
  assert.equal(r.body.category, 'secretlair');

  r = await call('GET', '/api/stats/dinosaur?category=nope');
  assert.equal(r.status, 400);
});

test('stats/:type: 404 when Scryfall has no such type', async () => {
  stubScryfall(() => ({ status: 404, body: {} }));
  const r = await call('GET', '/api/stats/notatype');
  assert.equal(r.status, 404);
});

test('every Scryfall request sends a custom User-Agent and Accept header', async () => {
  stubCatalog({ main: [card()], single: card() });

  await call('GET', '/api/cards/search?type=dinosaur');
  await call('GET', '/api/cards/id-1');
  await call('GET', '/api/stats/dinosaur');
  await call('POST', '/api/collection', { scryfallId: 'id-1' });

  // search (main + token queries), single card, stats (cached), add
  assert.ok(scryfallHeaders.length >= 4);
  for (const h of scryfallHeaders) {
    assert.equal(h['User-Agent'], 'mtg-collection/1.0');
    assert.equal(h.Accept, 'application/json');
  }
});

test('catalog is cached: category switches do not re-download from Scryfall', async () => {
  stubCatalog({ main: [card()] });

  await call('GET', '/api/cards/search?type=dinosaur');
  const afterFirst = scryfallHeaders.length;
  await call('GET', '/api/cards/search?type=dinosaur&category=tokens');
  await call('GET', '/api/cards/search?type=dinosaur&rarity=rare&upcoming=true');
  assert.equal(scryfallHeaders.length, afterFirst);
});

// ── PDF checklist export ──────────────────────────────────────────────────

const { buildChecklistModel } = require('../checklist');

test('checklist model: sections per category, split by rarity in order, tokens ungrouped', () => {
  const owned = (id, over) => card({ id, illustration_id: 'art-' + id, ...over });
  const model = buildChecklistModel({
    type: 'dinosaur',
    generatedAt: '2026-09-25',
    upcoming: false,
    categories: [
      {
        id: 'main',
        cards: [
          { ...owned('m-rare', { name: 'Zed', rarity: 'rare' }), owned: 2 },
          { ...owned('m-common-b', { name: 'Bravo', rarity: 'common', released_at: '2023-03-03' }), owned: 0 },
          { ...owned('m-common-a', { name: 'Alpha', rarity: 'common', released_at: '2019-05-01' }), owned: 1 },
          { ...owned('m-mythic', { name: 'Yak', rarity: 'mythic' }), owned: 0 },
        ],
      },
      { id: 'secretlair', cards: [{ ...owned('s1', { rarity: 'mythic', set: 'sld' }), owned: 0 }] },
      {
        id: 'tokens',
        cards: [
          { ...owned('t1', { name: 'Dinosaur' }), owned: 1 },
          { ...owned('t2', { name: 'Dinosaur Beast', rarity: 'common' }), owned: 0 },
        ],
      },
    ],
  });

  assert.equal(model.title, 'Dinosaur checklist');
  assert.equal(model.total, 7);
  assert.equal(model.owned, 3);
  assert.deepEqual(model.sections.map((s) => [s.label, s.owned, s.total]), [
    ['Main', 2, 4],
    ['Secret Lair', 0, 1],
    ['Tokens', 1, 2],
  ]);

  const main = model.sections[0];
  // common -> rare -> mythic, uncommon skipped because there are none
  assert.deepEqual(main.groups.map((g) => [g.label, g.owned, g.total]), [
    ['Common', 1, 2],
    ['Rare', 1, 1],
    ['Mythic', 0, 1],
  ]);
  // newest release first within a rarity (not alphabetical), quantity carried through
  assert.deepEqual(main.groups[0].items.map((i) => i.name), ['Bravo', 'Alpha']);
  assert.equal(main.groups[1].items[0].owned, 2);

  // tokens are all common, so one unlabeled group
  const tokens = model.sections[2];
  assert.equal(tokens.groups.length, 1);
  assert.equal(tokens.groups[0].label, null);
});

test('checklist model: same-day releases order by collector number, highest first, letters ignored', () => {
  const at = (id, number, over) => ({
    ...card({ id, illustration_id: 'art-' + id, collector_number: number, released_at: '2024-02-02', ...over }),
    owned: 0,
  });
  const model = buildChecklistModel({
    type: 'dinosaur',
    generatedAt: '2026-09-25',
    categories: [
      {
        id: 'main',
        cards: [
          at('a', '9', { name: 'Nine' }),
          at('b', '123a', { name: 'Showcase' }),
          at('c', '45', { name: 'Forty-five' }),
          at('d', '1', { name: 'Older set', released_at: '2020-01-01' }),
        ],
      },
    ],
  });
  assert.deepEqual(model.sections[0].groups[0].items.map((i) => i.name), [
    'Showcase',
    'Forty-five',
    'Nine',
    'Older set',
  ]);
});

test('checklist model: empty category has no groups', () => {
  const model = buildChecklistModel({
    type: 'dinosaur',
    generatedAt: '2026-09-25',
    categories: [{ id: 'secretlair', cards: [] }],
  });
  assert.deepEqual(model.sections[0].groups, []);
  assert.equal(model.total, 0);
});

test('export/checklist.pdf: requires type, returns a PDF download covering every category', async () => {
  let r = await call('GET', '/api/export/checklist.pdf');
  assert.equal(r.status, 400);

  stubCatalog({
    main: [
      card({ id: 'reg', rarity: 'common', illustration_id: 'art-1' }),
      card({ id: 'sld', rarity: 'rare', illustration_id: 'art-2', set: 'sld' }),
    ],
    tokens: [card({ id: 'tok', illustration_id: 'art-tok', set: 'tmom' })],
    single: card({ id: 'reg', illustration_id: 'art-1' }),
  });
  await call('POST', '/api/collection', { scryfallId: 'reg' });

  const res = await realFetch(`${base}/api/export/checklist.pdf?type=dinosaur`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /attachment; filename="mtg-dinosaur-checklist-\d{4}-\d{2}-\d{2}\.pdf"/);

  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(bytes.length > 1000);
  assert.ok(bytes.subarray(-1024).toString('latin1').includes('%%EOF'));
});

test('export/checklist.pdf: passes Scryfall errors through instead of sending a broken PDF', async () => {
  stubScryfall(() => ({ status: 503, body: {} }));
  const r = await call('GET', '/api/export/checklist.pdf?type=dinosaur');
  assert.equal(r.status, 503);
});
