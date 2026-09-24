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
- Search and stats collapse reprints of the same art down to one entry
  (`backend/artDedupe.js`), keeping the lowest-rarity printing. A `rarity`
  filter is applied *after* that collapse, to the surviving printing's own
  rarity -- so it means "this art's cheapest printing is this rarity," not
  "Scryfall has a printing at this rarity." Owned status is matched by art
  (any printing you own of that art counts), not by exact printing, via an
  `illustration_id` column on `owned_cards`. Rows added before that column
  existed need a one-time backfill: `docker compose exec mtg-collection node
  scripts/backfill-illustration-id.js`.

## Project Structure
```
mtg-collection/
├── backend/
│   ├── routes/          # API routes
│   ├── scripts/         # One-off maintenance scripts (e.g. backfill)
│   ├── test/            # API tests
│   ├── artDedupe.js     # Art dedupe + art-based owned matching (shared)
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

- `GET /api/cards/search?type=dinosaur&rarity=rare` - Search cards (one printing per art)
- `GET /api/collection` - Get owned cards
- `POST /api/collection` - Add card to collection
- `PATCH /api/collection/:id` - Update card
- `DELETE /api/collection/:id` - Remove card
- `GET /api/types` - Get tracked creature types
- `GET /api/stats/summary` - Aggregate counts + cover image (for the shelf hub)
- `GET /api/stats/:type` - Get collection statistics