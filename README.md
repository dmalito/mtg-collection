# MTG Collection Manager

A web-based Magic: The Gathering collection manager with card browsing, tracking, and search.

## Features

- 🃏 Browse cards by creature type (Dinosaurs, Dragons, etc.)
- 🔍 Search by name, artist, or set
- ✅ Track owned vs missing cards
- 📊 Filter by rarity, ownership
- 🔄 Sort by release date, price, artist, name
- 🖼️ Customizable grid layout (2-6 columns)
- 🎨 Compact and comfortable view modes
- 🪙 Include/exclude token cards

## Tech Stack

- **Frontend**: Svelte + Vite
- **Backend**: Node.js + Express (serves the API and the built frontend)
- **Database**: SQLite (`data/mtg.db`)
- **Data Source**: Scryfall API
- **Deployment**: Docker (single container, port 5006)

## Running (Docker)

```bash
docker compose up -d --build
```

App and API: http://192.168.0.16:5006 (health check: `/api/health`).

The SQLite db is bind-mounted from `./data`, so it survives rebuilds. To move
an existing db in, copy it to `data/mtg.db` before the first `up` (use
`sqlite3 old.db ".backup 'data/mtg.db'"` if the old app is still running).

## Development

Start both frontend and backend in dev mode:
```bash
./dev.sh
```

Frontend: http://192.168.0.16:5173 (Vite proxies `/api` to the backend)
Backend: http://192.168.0.16:3001

## Tests

```bash
cd backend && npm test
```

Uses Node's built-in test runner against a temp db, with Scryfall stubbed.

## Notes

- Every Scryfall request must carry a custom `User-Agent` (Scryfall returns
  400 `generic_user_agent` for library defaults) -- always go through
  `backend/scryfall.js`, never call `fetch` on Scryfall directly.
- The frontend is built with a relative Vite `base` and a relative API path,
  so it works at `/` or behind any path prefix.
- Cards are fetched with `unique=prints` and **every page** (Scryfall caps a
  search at 175 cards per page -- reading only page 1 silently drops the
  rest), then collapsed to one entry per art in `backend/artDedupe.js`,
  keeping the lowest-rarity printing. `unique=art` is deliberately not used:
  it makes Scryfall pick an arbitrary printing per art first, so there'd be
  no lower-rarity one left to prefer. Results are cached in memory for 10
  minutes (`backend/catalog.js`).
- Three categories, split *before* dedupe (so each is its own collection):
  `main`, `secretlair` (any Secret Lair set, whatever the rarity -- see
  `SECRET_LAIR_SETS`), and `tokens`. Owned status is scoped to the category,
  so owning the regular printing of an art doesn't mark its Secret Lair twin
  as owned.
- Not-yet-released cards (Scryfall lists spoilers with a future
  `released_at`) are hidden unless `upcoming=true`. They're filtered out
  *before* dedupe, so an unreleased cheaper reprint can't displace the
  released printing.
- A `rarity` filter is applied *after* dedupe, to the surviving printing's
  own rarity -- "this art's cheapest printing is this rarity", not "Scryfall
  has a printing at this rarity".
- Owned status is matched by art (any printing you own of that art counts),
  not by exact printing, via an `illustration_id` column on `owned_cards`
  (double-faced cards use their front face's art). Rows added before that
  column existed need a one-time backfill: `docker compose exec
  mtg-collection node scripts/backfill-illustration-id.js`.

## Project Structure
```
mtg-collection/
├── backend/
│   ├── routes/          # API routes
│   ├── scripts/         # One-off maintenance scripts (e.g. backfill)
│   ├── test/            # API tests
│   ├── artDedupe.js     # Art dedupe, Secret Lair detection, art-based owned matching
│   ├── catalog.js       # Paged + cached Scryfall fetch, split into categories
│   ├── checklist.js     # PDF checklist export (pdfkit)
│   ├── db.js            # SQLite setup (DATA_DIR env for the db location)
│   ├── scryfall.js      # Scryfall fetch wrapper (User-Agent)
│   ├── server.js        # Express server
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/  # Svelte components
│   │   ├── lib/        # API client, utilities
│   │   └── App.svelte  # Main app
│   ├── public/         # Static assets
│   └── package.json
├── data/               # SQLite db (bind-mounted, gitignored)
├── Dockerfile
├── docker-compose.yml
├── dev.sh             # Development server script
└── README.md
```

## Backend API

- `GET /api/cards/search?type=dinosaur&category=main&rarity=rare&upcoming=true` - Search cards (one printing per art). `category`: `main` (default) | `secretlair` | `tokens`; `rarity` and `upcoming` optional. Response includes `counts` per category and `upcomingCount`.
- `GET /api/collection` - Get owned cards
- `POST /api/collection` - Add card to collection
- `PATCH /api/collection/:id` - Update card
- `DELETE /api/collection/:id` - Remove card
- `GET /api/types` - Get tracked creature types
- `GET /api/export/checklist.pdf?type=dinosaur&upcoming=true` - PDF checklist of every category, split by rarity, owned cards ticked (also the "Export PDF checklist" link in the app header). Ignores the on-screen filters; `upcoming` optional
- `GET /api/stats/summary` - Aggregate counts + cover image (for the shelf hub)
- `GET /api/stats/:type` - Get collection statistics (takes the same `category` and `upcoming` params as search, so the numbers match the list)