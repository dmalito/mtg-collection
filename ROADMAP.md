# Roadmap

Ideas noted for later, not yet built. Each item carries a priority from
**P1** (do first) to **P5** (someday), and the list is sorted by it.

## Upcoming

- (P3) **Show the MTG dinosaur collection in a binder**: view the owned
  dinosaur cards laid out as binder pages, like the physical binders in the
  card catalogue, instead of only the search/grid list. Open questions for
  when this is picked up: whether it lives in this app or on the shelf hub
  (which currently has no MTG entry -- see `shelf/README.md`), and how to
  page/order the cards (by set, release date, rarity). `/api/stats/summary`
  already exists as a starting point for the hub side.

## Done

- Moved to Docker (port 5006), with API tests and a Scryfall User-Agent
  wrapper (2026-09-24).
