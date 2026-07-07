---
status: accepted
---

# One-way platforms are their own tile type (`=`), horizontally transparent

> Vocabulary: [`CONTEXT.md`](../../CONTEXT.md) — One-way platform, Wall, Terrain.
> Extends the one-way platform rule of #262 (global vertical one-way); this ADR
> revises its **horizontal** half. A fix-forward within the demo freeze
> ([ADR 0024](./0024-demo-scope-freeze-and-stop-line.md)) — a broken existing
> mechanic made whole, not a new one.

#262 made every solid tile **one-way vertically**: a descending body lands on a
tile's top surface (guarded by "came from above"), a rising body passes straight
through with no head-bonk. Its decision was recorded as *global one-way, one solid
tile type, no per-tile distinction* — justified because the shipped zones have no
ceilings, so nothing about vertical motion needed a second tile type.

But that decision only defined the **vertical** axis. Horizontally, `stepEntity`
still blocked against *every* solid via `isSolid`. So while a body's box rose
*through* a one-way platform, the horizontal collision pass treated the very tile it
was passing through as a wall and zeroed `vx` — manual QA reported it as *"jumping up
through a platform halts sideways movement, feels awkward."* This is the horizontal
gap #262 left open, surfaced in the v0.5.0 QA pass.

The tension is real and cannot be closed on one tile type: **a wall and a floor are
the same glyph, yet horizontally they must differ** — a wall blocks you beside it, a
platform must let you slide through as you rise. `field-03` actually contains *both*:
vertical wall posts *and* horizontal ledges, sometimes meeting at a corner. No purely
geometric run-time rule classifies those corners the way a level author intends.

## Decision

- **A one-way platform is a distinct, authored tile type.** The `.zone` (and
  `parseTerrain`) grid gains `=` for a one-way platform alongside `#` for a wall.
  `Terrain.cells` encodes it: `0` empty, `1` wall, `2` platform. Authored, not
  derived — the author decides wall-vs-platform per tile, which a geometric heuristic
  can't do for mixed structures like `field-03`'s posts-plus-shelf.

- **A platform differs from a wall on the HORIZONTAL axis only.** Vertically the two
  are identical and #262's global one-way rule stands unchanged: `isSolid` is
  nonzero-means-solid, so a descending body lands on either. The new `isWall`
  (`cells === 1`, with the same out-of-bounds handling as `isSolid`) gates the
  horizontal sweep in `physics.ts`. A platform is skipped there, so a body sliding
  left/right while it rises through the platform keeps its horizontal velocity.
  Walls — and the world bounds, which read as walls — still block every side.

- **No head-bonk, no ceiling logic.** We did *not* make `#` a two-sided wall; a
  rising body still passes any solid vertically (no ceilings exist in any zone). The
  only behavioural change is horizontal transparency for `=`.

- **Existing zones were migrated by intent.** Every elevated `#` that is a thin
  horizontal ledge (empty above and below) became `=`; every `#` with a vertical
  neighbour (a wall post, the ground stack) stayed `#`. `field-03`'s wall posts
  (cols 180/197/199) stay walls; its shelf interior and all isolated ledges are
  platforms. The renderer is untouched — a 1-row platform already draws as a `▄`
  surface ledge via `isSolid`.

- **The format surface all learned `=`.** `parseTerrain`, `parseZone` (which also
  reserves `=` as a non-authorable glyph key), `zoneValidate.clipsSolid` (a platform
  is solid footprint, so an entity can't be embedded in one), and the forge
  serializer (`cells 2 → =`, so an editor round-trip never drops platforms).

## Consequences

- Content authors now choose wall vs platform explicitly. The freeze forbids
  authoring new zones, so this is exercised only by the migration above and any edit
  to an existing zone.
- A future internal vertical wall is now expressible (`#`) and correct, where the
  pre-#262-revision single type could not both wall it and pass its platforms.
- Vertical behaviour, and every #262 vertical test, is unchanged.
