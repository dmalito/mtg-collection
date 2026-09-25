# ── Stage 1: build the Svelte/Vite frontend ─────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
# vite.config.js uses a relative base and api.js a relative API path, so the
# build works at / or under any path prefix.
RUN npm run build

# ── Stage 2: runtime — Express serves the API and the built frontend ────────
# node:20-slim (Debian) rather than alpine, since sqlite3's native bindings
# are more reliably prebuilt for glibc than for musl.
FROM node:20-slim
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5006
ENV DATA_DIR=/app/data

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/db.js backend/scryfall.js backend/artDedupe.js backend/catalog.js backend/checklist.js backend/server.js ./
COPY backend/routes/ ./routes/
COPY backend/scripts/ ./scripts/

# Built frontend assets, served statically by Express
COPY --from=frontend-build /app/frontend/dist ./public

# sqlite db lives here — bind-mounted so it survives image rebuilds
RUN mkdir -p /app/data

EXPOSE 5006
CMD ["node", "server.js"]
