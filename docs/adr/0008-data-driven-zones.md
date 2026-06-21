---
status: accepted
---

# Zones as data: a serialized `.zone` format and a pure loader

> Vocabulary: [`CONTEXT.md`](../../CONTEXT.md) — Zone, Terrain, Monster, NPC,
> Portal. Initiative PRD: [#50](https://github.com/0Calories/terminal-mmo/issues/50).

A [Zone](../../CONTEXT.md) today **is code**. `makeFieldZone()` / `makeTownZone()`
are factory functions in `packages/shared/src/world.ts` that construct a `Zone` at
runtime, and the field's [Terrain](../../CONTEXT.md) is scattered by a seeded RNG
(`makeStarterField`). There is no serialized Zone format and no loader: you cannot
design or preview a room without writing imperative TypeScript and re-running the
game, tweaking one platform means re-rolling the whole seed, and **agents** can't
reliably author Zones — wrangling factory code with seeded RNG is exactly what they
are bad at. The two shipped Zones are low-quality and barely playable.

This ADR records the decision to move Zones **from code to data**, and is the
design-review gate the downstream slices build on — the same role ADR 0006 played
for the sim split. It pins the format, the purity boundary, and the
by-reference entity model so every downstream issue references one source of truth.

> **Numbering note.** The initiative (PRD #50, issue #51) was filed calling this
> "ADR 0007". That number was taken by [ADR 0007 (speech bubbles)](./0007-speech-bubbles.md)
> in the interim, so this is **ADR 0008**. Same decision, next free number.

## Decisions

- **Zones are serialized data, loaded by a pure parser in `@mmo/shared`.** A new
  `parseZone(text, catalogs): Zone` sits beside `parseTerrain` (`terrain.ts`):
  pure, deterministic, framework-free, no file or socket I/O. It sets the authored
  fields, resolves catalog references, and initializes runtime state (Monsters from
  spawns, empty projectiles, id counters) — returning the exact `Zone` shape the
  sim already consumes. The factories (`makeFieldZone` / `makeTownZone`) and the
  procedural generator (`makeStarterField`) are **retired**.

- **The `.zone` format is a JSON header + `---` + an ASCII grid.** The header is a
  single JSON object (`id`, `type`, and keyed glyph maps); the body, below a `---`
  delimiter, is an ASCII grid that draws Terrain and anchors entities:

  ```
  { "id": "field-01", "type": "field",
    "spawns":  { "c": "goblin-01", "s": "archer-01" },
    "portals": { "a": { "target": "town-01", "arrival": [12, 32] } },
    "npcs":    { "m": "merchant-01" } }
  ---
  ..................................
  ..........###.......###...........
  ..c....s.........a................
  ##################################
  ```

- **Grid holds position; header holds identity/config; box extents are
  engine-derived.** `#` = solid, `.` = empty (reusing the `parseTerrain` `#`-grid
  idiom), and any other glyph anchors **one** entity at that cell, resolved through
  the header's maps. Grid dimensions are **inferred** from the body — there is no
  `w`/`h` field. Entity box sizes (spawn 5×5, [Portal](../../CONTEXT.md) fixed 4×7)
  are derived by the engine from the anchor cell, not authored. Overlapping anchors,
  unknown glyphs, and orphan header keys (a glyph with no grid cell, or vice versa)
  are **validation errors**, not format features.

- **Entities are by-reference; only Portals are inline.** Both [Monster](../../CONTEXT.md)
  spawns and [NPCs](../../CONTEXT.md) map a glyph → a stable **catalog id** resolved
  against minimal, separately-authored catalogs (`monsters: {id, behavior:
  chaser|shooter, name}`, `npcs: {id, kind, name}`). The Zone is *pure placement* —
  *which entity lives where*. Portals stay inline because target/arrival are
  world-graph facts with no separate entity behind them. Catalogs start minimal and
  grow (loot, dialogue, sprites) **without touching the Zone format**.

- **JSON header, not YAML.** The visual part of the format is the grid; the header
  is config. JSON fails loudly on malformed input, needs no dependency, and agents
  emit it flawlessly — all three matter more than YAML's terseness for a config
  block this small.

- **Purity boundary: parse/validate in `shared`, disk I/O in server/tooling.** The
  pure core takes strings (Zone text + catalog text) and returns a `Zone` or
  validation errors. Reading `.zone` and catalog files off disk — at runtime from a
  repo-root `zones/` directory, and in the `zone-tools` CLI — lives in the server
  and tooling layers. (Build-time bundling of zones is deferred; runtime reads disk
  for now.)

## Considered and rejected

- **Keep Zones as code (factories + procedural generation).** The status quo. The
  whole point is to let humans *and agents* design and preview a room without
  writing imperative TypeScript; seeded RNG also makes targeted edits impossible
  (one tweak re-rolls the field). Codegen has the same agent-hostility.

- **Pure ASCII (no header) or pure data (no grid).** A grid alone cannot express
  identity/config (a Zone id, which Monster a glyph means, portal targets); a data
  blob alone throws away the one thing that *must* be visual — the room layout you
  are designing and previewing. The hybrid keeps each in the representation it
  belongs in.

- **YAML header.** Adds a dependency and parses leniently (silent coercions), the
  opposite of the loud-failure property we want for an agent-authored format.

- **Entities inline in the Zone (full stats per spawn).** Bloats every Zone file
  with duplicated Monster/NPC definitions and couples placement to content. By
  reference, catalogs become the single place rich entity content grows; the Zone
  stays pure placement. Portals are the deliberate exception — they have no entity.

- **Author `w`/`h` in the header.** Redundant with the grid and a source of
  drift; dimensions are inferred and the grid is the single source of truth.

- **Disk I/O inside `parseZone`.** Breaks the shared-package purity rule (ADR
  0002) and makes the parser untestable without a filesystem. I/O stays at the
  edges; the core is a pure string→`Zone` function, unit-tested like `parseTerrain`.

## Consequences

- `@mmo/shared` gains `parseZone` (+ catalog schemas) beside `parseTerrain`, and
  loses `makeFieldZone` / `makeTownZone` / `makeStarterField`. `createWorld` (and
  any test relying on the factories) is rewired to load parsed Zones; the runtime
  reads `.zone` + catalog files from a repo-root `zones/` directory.
- A two-tier validator follows: per-file structural / placement / walkability /
  type-rule checks, plus a whole-set pass resolving the Portal graph and catalog
  references. Type rules + walkability are errors; a one-way Portal is a warning.
- A new `packages/zone-tools` CLI (depends on `@mmo/shared`) exposes
  `render` / `check` / `new` (renderer-free, the agent/CI path) and, later,
  `preview` (a human live-reload visual reusing the real `playfield.ts` renderer)
  and `play` (playable test-play). These are the downstream slices this gate
  unblocks; see PRD #50 for sequencing.
- The shipped `town-01` + `field-01` are re-authored as `.zone` files; the seeded
  procedural field is gone, so the field becomes a hand-designed, reproducible room.
