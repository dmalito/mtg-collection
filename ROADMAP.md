# Roadmap

Ideas noted for later, not yet built. Each item carries a priority from
**P1** (do first) to **P5** (someday), and the list is sorted by it.

## Upcoming

- (P4) **Fix the owned-toggle for multi-printing art**: `App.svelte`'s
  unown button removes by the deduped entry's exact `scryfall_id`, but
  `owned` can now be a sum across several printings of the same art (see
  Done, below). Unowning an art you own via two different printings only
  deletes one row, so the entry can show owned again after a reload. Needs
  either a proper multi-printing owned UI or a "remove from the most likely
  printing" heuristic -- a real design problem, not a quick fix.

## Done

- Moved to Docker (port 5006), with API tests and a Scryfall User-Agent
  wrapper (2026-09-24).
- Search and stats collapse reprints of the same art to one entry (lowest
  rarity wins), with a rarity filter applied after that collapse instead of
  before it, and owned status matched by art instead of by exact printing
  (2026-09-24).
- Categories and upcoming toggle: Secret Lair printings and tokens are their
  own lists (tabs with counts), and not-yet-released cards are hidden behind
  an "Upcoming" toggle. Also fixed the list being cut off at Scryfall's
  first page (175 of 306 dinosaur arts), lowest-rarity dedupe (needs every
  printing, not Scryfall's `unique=art`), and double-faced cards (no image,
  never deduped) (2026-09-25).
- PDF checklist export: every category on its own page(s), split by rarity,
  owned cards ticked (2026-09-25).
- The owned cards as a 3 x 3 binder on the shelf hub (`shelf/`, :5004):
  this app serves `GET /api/binders/summary` and `GET /api/binder/<name>` in
  the same shape as the card catalogue's binders, oldest release first
  (`released_at` is stored on add and backfilled from Scryfall on first
  view), and the shelf shows it as a spine with its one-page-at-a-time
  viewer (2026-09-26).
