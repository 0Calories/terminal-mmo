---
status: accepted (per-cell Terrain sampling superseded by ADR 0038)
---

# Sprite ground contact: planted feet via per-sprite baseline + per-cell terrain compositing

> **Note:** The planted baseline and half-height Terrain surface remain accepted.
> [ADR 0038](./0038-sub-cell-scene-compositor.md) supersedes `PlantContext` and manual
> Terrain sampling with transparent Pixels revealing the composed Terrain beneath.

The redesigned humanoid Form ("buddy", `FORMS[0]`) authors its feet as the
upper-half block `▀`, which inks only the **top half** of its cell and leaves the
bottom half air. Every frame does this — `idle` (`··▀···▀··`), `walkA`
(`·▀·····▀·`), `walkB` (`···▀·▀···`), and `jump` (`▀ ·· ·▀`). The sprite is
anchored feet-to-box-bottom (`sy = e.y + BOX.h - sprite.h`, `render.ts`), which
lands the feet row in the cell *directly above* the terrain. Terrain renders every
solid cell as a full `█` one row below, so the stack reads
`foot-ink (top) → air (bottom of the feet cell) → █`, and the Avatar floats half a
cell above the ground in every pose. The same latent bug affects the shooter
Monster (`·▝▀▀▀▘·`, all upper-ink).

This is structural, not a tuning error: a half-block foot can only butt cleanly
against whatever is on its *ink* side, and a `▀` foot's air-side faces the ground.
Lowering the ink to `▄` plants the foot but severs it from the body (the air-half
now faces *up*, opening an ankle gap). The only way a `▀` foot both connects to the
body and touches ground is to stop drawing it in the empty cell above the terrain
and render it **into the terrain surface cell itself**.

## Decisions

1. **Plant the feet into the terrain surface cell.** The sprite's bottom row is
   drawn on `e.y + BOX.h` (the solid terrain row) instead of one cell above it.
   The body row directly above stays adjacent — and therefore connected — because
   the *whole* sprite shifts down by one, not just the feet (dropping the feet row
   alone would reopen the gap between body and feet).

2. **The shift is a per-sprite `baseline` offset, not a global anchor change.** An
   optional baseline (default `0`) is declared per `BodySprite`/Form — so it applies
   uniformly across that Form's whole frame set (idle/walk/jump) — and per
   single-frame `Sprite` for the legacy Monster path. The buddy Form sets `1`. The
   float is **not** universal: `merchant` (`▝████▘`, full-block feet) and `chaser`
   (`▞····▚·`, lower-ink diagonals) already touch the surface, so a global `+1`
   would drop *their* feet into the terrain and render them half-buried. A per-sprite
   baseline scopes the fix to ink-top-footed sprites and leaves the others rendering
   exactly as today. This is a principled authoring parameter (a sprite
   pivot/baseline), and it rides the same per-body anchor rails ADR 0020 already uses
   for the Form's grip and head cells. The shooter adopts `baseline: 1` plus `▀` feet
   when it is next redrawn; merchant and chaser keep `0`.

3. **Ground is shown through the foot's air-half by general per-cell compositing.**
   For every body-sprite cell drawn over a *solid* world cell, the renderer paints
   `bg = terrainFg`. This is mandatory: terrain draws first with `bg = terrainBg`
   (its *hidden* shade), and a transparent-bg `▀` over it preserves `terrainBg`, not
   the visible block colour — so without the explicit paint the foot's bottom half
   renders as a faint dark notch rather than ground. **The overhead-label code
   already proves this exact fix** (ADR 0016, `render.ts`): it `setCell`s the cell to
   solid `terrainFg` *before* alpha-blending "otherwise the blend would composite
   over `terrainBg` and stamp a dark box." We reuse that base-then-blend pattern. The
   rule is **general** (any sprite cell over solid terrain, keyed on the `isSolid`
   check the renderer already runs), not feet-specific metadata, so a future `sit`
   emote, a planted weapon, or a crouch composite correctly for free. It is scoped to
   the **body/sprite layer**; combat telegraphs render above everything and set their
   own bg, so they stay exempt.

4. **No ground beneath a foot means the foot floats, and that is correct.** The
   baseline applies every frame, but the composite only fires over solid ground.
   Airborne (the `jump` pose, `▀ ·· ·▀`) and ledge-edge (a foot past the platform
   lip) feet therefore render as transparent `▀` hanging in air — the right read for
   feet that aren't touching anything. The already-shipped `jump` pose carries any
   tucked-foot styling; we do not sample terrain per foot column or author a
   half-planted pose.

5. **The terrain top surface renders as a lower-half block `▄`, dropping the visible
   ground line half a cell.** Decisions 1–3 alone *bury* the foot: dropping the figure
   a full cell lands the slim `▀` boot — whose ink is only the cell's *top* half — into
   a full-`█` surface cell, so the boot reads as half-sunk below a ground line that sits
   at the cell's top edge. The fix is to move the **ground**, not the figure: a solid
   cell with air directly above (`!isSolid(wx, wy-1)`) draws as `▄`, so its visible top
   edge falls to the cell's vertical middle. A `▀` boot composited into that cell then
   rests its bottom edge *on* that line — boot in the top half (above the line), ground
   in the bottom half (the composite) — while staying joined to the body in the cell
   above. This is what makes a slim, top-ink foot **simultaneously connected, slim, and
   flush** — the trilemma the half-block grid otherwise forbids (a top-ink foot's bottom
   edge lands at a cell *middle*, so no integer baseline alone can make it flush). Only
   the exposed top row lowers; interior cells stay `█`.

   The cost is borne by sprites that have **not** adopted ink-top contact feet: a
   full-block or lower-ink foot ends at a cell *bottom*, so it can only be flush against
   a ground line at a cell *top* (the old `█` surface). Once the line drops to `▄`,
   `merchant`/`chaser`/`shooter` and the NPCs float a half-cell until re-arted. This is
   accepted as the transitional state of the one-sprite-at-a-time convergence (it is the
   same end-state the rejected "global anchor change" below describes, reached gradually):
   the buddy plants flush now; each other sprite plants the day it gains `▀` feet +
   `baseline: 1`. The `█` surface is no longer reachable, so full-block contact feet are
   no longer a fallback — every grounded sprite converges on ink-top contact feet.

## Considered and rejected

- **Lower the feet ink to `▄` at the current anchor.** Plants the foot on the
  surface but severs it from the body — the air-half now faces up, opening an
  ankle-height gap. Rejected; it trades the float for a detachment.
- **Full-block `█` feet.** Connects both up and down with no anchor or render
  change, but discards the slim half-block foot the redesign is built around. Was
  retained as a fallback, but decision 5 lowers the ground line to `▄`, which a
  full-block foot can no longer sit flush on — so this is now ruled out, not a fallback.
- **A fourth sprite row.** Gives the foot its own cell but changes world-scale;
  ADR 0020 fixed the footprint at 9×3 so platform spacing and jump height stay
  valid. Rejected as the expensive option.
- **Global anchor change + re-author every sprite to ink-top contact feet.** The
  cleaner long-term model ("a sprite's bottom row is always its contact row"), but
  it forces a merchant/chaser re-art *now*, outside the Form work. Deferred:
  per-sprite baselines converge on this end-state one sprite at a time.
- **Feet-specific compositing metadata.** Marking a contact row per frame is more
  data for no gain over the general `isSolid` check, and it would not cover
  non-foot cells that overlap terrain. Rejected.

## Consequences

- `BodySprite`/Form and the single-frame `Sprite` gain an optional `baseline` field;
  `drawEntitySprite` adds it to the `sy` computation. Only the buddy Form sets a
  non-zero value initially.
- `drawEntitySprite` and `blitSprite` take neither `terrain` nor a world offset
  today, so both must learn them to run the per-cell `isSolid` check and choose
  `terrainFg` vs transparent for each cell's background. This is the signature
  change; it reuses the base-then-blend pattern from the ADR 0016 nameplate path.
- The convention is precedent-setting: every future pose, Form, and (eventually)
  animated Monster inherits "planted when over ground, floating when not" for free,
  and authoring a new grounded sprite is "ink-top feet + `baseline: 1`."
- `renderZoneScene` renders a top-surface solid cell (air directly above) as `▄`
  instead of `█` (decision 5). This is a global, sprite-agnostic terrain change, so the
  visible ground line is half a cell lower everywhere — a thinner surface line, the same
  through the forge preview and the live client (one shared render path).
- `merchant`, `chaser`, `shooter`, and the NPCs float a half-cell over the lowered
  line until each adopts `▀` feet + `baseline: 1`. This is the deliberate transitional
  cost of decision 5, not a regression to fix in isolation; it resolves per sprite as
  the art converges. (It supersedes the earlier "merchant/chaser render exactly as
  today" expectation, which assumed the `█` surface.)
</content>
