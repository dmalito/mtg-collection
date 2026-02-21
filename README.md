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
- **Backend**: Node.js + Express
- **Database**: SQLite
- **Data Source**: Scryfall API

## Development

Start both frontend and backend in dev mode:
```bash
./dev.sh
```

Frontend: http://192.168.0.16:5173
Backend: http://192.168.0.16:3001

## Deployment

Build and deploy to production:
```bash
./deploy.sh
```

Access at: http://192.168.0.16/mtg

## Project Structure
```
mtg-collection/
├── backend/
│   ├── routes/          # API routes
│   ├── db.js           # SQLite setup
│   ├── server.js       # Express server
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/  # Svelte components
│   │   ├── lib/        # API client, utilities
│   │   └── App.svelte  # Main app
│   ├── public/         # Static assets
│   └── package.json
├── deploy.sh           # Production deploy script
├── dev.sh             # Development server script
└── README.md
```

## Backend API

- `GET /api/cards/search?type=dinosaur&rarity=rare` - Search cards
- `GET /api/collection` - Get owned cards
- `POST /api/collection` - Add card to collection
- `PATCH /api/collection/:id` - Update card
- `DELETE /api/collection/:id` - Remove card
- `GET /api/types` - Get tracked creature types
- `GET /api/stats/:type` - Get collection statistics