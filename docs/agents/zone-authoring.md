# Authoring & previewing Zones

How an agent designs `.zone` content (ADR 0008) and **judges how it looks** —
including the parts that don't need a real terminal.

> Zones are data. The repo-root `zones/` dir is the single source of truth: the
> `.zone` files (a JSON header + an ASCII grid) plus `catalogs.json` (the
> monster + NPC definitions glyphs resolve against). See ADR 0008 and #50.

## The authoring loop

All commands are workspace scripts (`bun run zone <cmd>`); the CLI lives in
`@mmo/zone-tools`.

```bash
bun run zone new <id> --type field|town   # scaffold a blank <id>.zone
bun run zone render <id>                   # ASCII dump + per-file diagnostics
bun run zone check [dir]                   # whole-set validation (CI gate)
bun run zone preview <id>                  # live, faithful TUI render (needs a TTY)
bun run zone play <id>                     # boot the Zone into the offline sim (needs a TTY)
```

`zone check` (also `bun run zones:check`, part of `bun run ci`) is the invariant:
portal round-trips resolve, arrivals land on walkable ground, spawns/NPCs rest on
ground, catalog refs resolve. The authored set is also asserted clean in
`packages/shared/test/zoneContent.test.ts`, so a broken build fails `bun test`.

### Geometry that has to line up

- Grid height **40** makes the world floor `y=37..39` (`GROUND_TOP = 40-3 = 37`).
  The shared `SPAWN (10,32)`, `TOWN_SPAWN (12,32)`, and portal arrivals all assume
  this floor — keep it unless you also change `constants.ts`.
- An entity's 5×5 box (`BOX`) anchored at row `Y` **rests on** a surface solid at
  `Y+5`. A monster standing on a platform whose surface is row `S` is anchored at
  `S-5`. The Town is the start Zone, so `SPAWN` must be clear, grounded floor.

## Judging a build *without* a terminal

`zone render` gives a schematic ASCII dump (terrain `#` + single-letter glyphs).
`zone preview` / `zone play` give the real, colored, animated view — but they take
over the TTY, so **an agent cannot see their output** (there's no screenshot to
read, and a subagent has the same Bash/file tools — it's just as blind).

To actually *see and critique* a build, drive the **shared renderer** —
`renderZoneScene` (the exact one `zone play` uses) — into an in-memory buffer and
dump the glyph frame. The renderer is generic over `CellBuffer<C>`, so no opentui /
TTY is involved:

Put the script at the **repo root** (e.g. `view.ts`, untracked) and import the
shared entry by path — the `@mmo/shared` workspace alias only resolves *inside* a
package that depends on it, not from a standalone scratch file:

```ts
import {
  buildSceneStyle, createGame, drawEntitySprite, renderZoneScene,
  type CellBuffer,
} from './packages/shared/src';

class TextBuffer implements CellBuffer<string> {
  width: number; height: number; grid: string[][];
  constructor(w: number, h: number) {
    this.width = w; this.height = h;
    this.grid = Array.from({ length: h }, () => Array(w).fill(' '));
  }
  clear() { for (const r of this.grid) r.fill(' '); }
  setCell(x: number, y: number, ch: string) {
    if (y >= 0 && y < this.height && x >= 0 && x < this.width) this.grid[y][x] = ch;
  }
  setCellWithAlphaBlending(x: number, y: number, ch: string) { this.setCell(x, y, ch); }
  dump() { return this.grid.map((r) => r.join('').replace(/\s+$/, '')).join('\n'); }
}

const style = buildSceneStyle<string>(() => 'x'); // glyphs only; colour irrelevant
const g = createGame();                            // boots the authored set in the start Zone
const z = g.world.zones[g.player.zoneId];
const buf = new TextBuffer(z.terrain.w, z.terrain.h); // whole Zone in one frame
renderZoneScene(buf, {
  terrain: z.terrain, portals: z.portals, npcs: z.npcs ?? [], entities: z.monsters,
}, { x: 0, y: 0 }, style);
drawEntitySprite(buf, g.player.avatar, { x: 0, y: 0 }, style); // Avatar on top (ADR 0003)
console.log(buf.dump());
```

Run it from the repo root with `bun run view.ts`, then delete the scratch file
(it's untracked, not committed). This renders the **real sprites, portal door,
NPC, and terrain** — what you get is a
faithful single frame minus colour, enough to judge spacing, reachability,
sprite placement, and legibility. For a zoomed/scrolled view, pass a `cam` offset
(mirror `followCam` in `zone-tools/src/play.ts`) instead of `{x:0,y:0}`.

**What this still can't tell you:** colour, and motion (jump arcs, monster
aggro, camera feel). Those need a human running `zone preview` / `zone play` in a
real terminal — say so rather than claiming you verified them.
