---
status: accepted (nameplate-pill decisions superseded by ADR 0023; backdrop sampling superseded by ADR 0038)
---

# Overhead labels: a translucent nameplate pill; bubbles sit on the colour under them

> **Note:** The **nameplate-pill** decisions below (the 2-row translucent pill, the
> per-cell terrain-sampled wash, and the `nameplateWashes` catalog) are **superseded
> by [ADR 0023](./0023-nameplate-text-overlay.md)**. The terrain-is-a-foreground-block
> analysis and the **bubble + emote appearance** decisions in this ADR still stand.
> [ADR 0038](./0038-sub-cell-scene-compositor.md) supersedes the manual per-cell
> Terrain-sampling mechanism with composition against the actual scene.

The three labels that float over an Avatar — its **nameplate** (the boxed Handle
below the feet, #103), its **Speech bubble**, and its **Emote** (the last two share
one over-head box, #59 / #38, ADR 0007) — were originally drawn as fully opaque
boxes so terrain "can't bleed through and the handle stays legible on solid ground"
(#103); ADR 0007 likewise lists "must occlude terrain" as part of the bubble's
rationale.

In practice the opaque fill *fully* hid whatever terrain a label overlapped, so a
nameplate standing on solid ground stamped a heavy dark rectangle into the world.
Several attempts at a "translucent" fix each failed in an instructive way, and the
failures pin down the one fact that dictates the design:

1. A single ~50%-alpha tint across the **whole box, frame included**. The tint
   visibly extended **outside** the rounded border.
2. Frame/padding cells with a **transparent** background, on the theory that "alpha
   auto-adapts, so no per-cell terrain sampling is needed." Shipped, and the box
   *still* stamped a dark rectangle.
3. Per-cell sampling with a **thin rounded frame over a translucent chip**. The dark
   rectangle was gone, but a thin frame can never be a *fully solid* backplate — the
   cell around the thin line still shows the world, so any seam reads as residual
   spill, and legibility still rode on a translucent chip's contrast over terrain.

## The fact that dictates everything: terrain is a foreground block

`renderZoneScene` draws solid ground as `setCell('█', terrainFg, terrainBg)`. The
bright colour you see (`terrainFg [70,82,104]`) is the **foreground `█` glyph**; the
cell's **background** is the dark `terrainBg [34,40,54]`.

So the instant a label cell draws *any* glyph — a border line, a `▒`, a letter — it
**replaces that `█`**, and whatever background that cell carries is what shows around
the new glyph. "Transparent background" reveals the dark `terrainBg`, not the bright
terrain; and `setCellWithAlphaBlending` blends over `terrainBg`, never over the
terrain you actually see. That is why attempts 1 and 2 produced a dark rectangle: the
"alpha auto-adapts" reasoning was wrong — there is nothing bright to adapt over.

**Conclusion: to make a label cell look like it sits *on* terrain, that cell's
background must be explicitly set to `terrainFg`. That requires sampling, per cell,
whether solid ground is below.** Per-cell terrain sampling is required, not optional.

The two label families then diverge, because their needs differ: the nameplate is a
tiny identity tag that wants to sit *quietly* — a faint colour wash where it overlaps
ground, and nothing but the name where it doesn't — while the bubble is a multi-line
panel that wants terrain to *read through* its frosted body.

## Decisions

- **The nameplate is a 2-row translucent pill in the cosmetic colour — no frame.**
  It is a short rounded pill drawn directly below the feet:

  ```
  ▟ neo ▙   top row: bevelled top corners (▟▙), a pad column each side, the Handle on top
  ▝▀▀▀▀▀▘   bottom row: a thin upper-half lip (▀) with rounded ends (▝▘)
  ```

  Over terrain the pill **body** is a faint translucent **wash of the Avatar's cosmetic
  nameplate colour** — each pill cell is flattened to the `terrainFg` base and the wash
  (`NAMEPLATE_WASH_ALPHA`, ~8%) is alpha-blended over it — and the **Handle** is drawn
  on top at **full opacity**. Because the wash and the Handle are the same hue but differ
  sharply in brightness (translucent-over-terrain vs. opaque), the name reads against its
  own pill, and a coloured pill (rather than a dark plate) ties the chip to the player's
  cosmetic identity. **Off terrain the pill is omitted entirely and only the Handle
  glyph shows**, floating on whatever is behind — so on the Avatar-creation panel (which
  passes an all-empty terrain) the chip degrades to just the coloured name, no box.

  Because `@mmo/core` is generic over the colour type `C` and holds only opaque
  resolved colours, it cannot derive a low-alpha variant at draw time. `buildSceneStyle`
  therefore prebuilds a parallel `cosmetics.nameplateWashes` catalog (each
  `NAMEPLATE_COLORS` entry at `NAMEPLATE_WASH_ALPHA`) plus a default `nameplateWash`.

- **The bubble + emote sit on the colour under each cell.** They keep their frame and
  tail, but every cell first samples the base — `terrainFg` over solid ground, else
  the sky `bg` — and draws over it: the frame/tail are the border glyph over the base
  (no dark stamp); interior **padding** is a **`▒` (50%) shade** in a dark fg over the
  base, a dithered "frosted glass" that lets terrain read through the stipple; and
  **text** is a bright `bubbleFg` glyph on a **~50% dark backing**, laid in two passes
  (`setCell` the base, then `setCellWithAlphaBlending` the glyph) since a cell can't
  hold both a backing and a letter in one blended call. The `▒` padding and the 50%
  backing resolve to the same colour over a given base, so the interior reads as one
  frosted surface. Multi-line chat stays light-on-dark, which reads better than the
  nameplate's dark-on-colour would.

- **The two families are intentionally *not* in lockstep.** Earlier the three labels
  shared one geometry to avoid drift; here the nameplate (solid chip) and the bubble
  (framed, frosted) genuinely want different things, so they no longer share a backing
  rule. The bubble and emote still share `drawOverheadBox`, so *those two* can't drift.

- **This *qualifies* ADR 0007; it does not overturn it.** ADR 0007's "must occlude
  terrain" was chiefly an argument for keeping the bubble on the *imperative
  playfield* rather than in retained React chrome. That is unchanged: the bubble is
  still drawn per-frame on the hot path, and only its backing changes. The
  retained/imperative seam from ADR 0005 is untouched.

## Considered and rejected

- **Keep everything opaque (the #103 / ADR 0007 status quo).** Maximally legible, but
  stamps an opaque rectangle over the world — the original problem.
- **One ~50% tint across the whole box, frame included.** Tint bleeds outside the
  rounded border (frame cells paint a square background behind a thin line).
- **Transparent frame/padding, "alpha auto-adapts, no sampling."** Alpha blends over
  the dark `terrainBg`, so the box still stamps a dark rectangle. Terrain being a
  *foreground* block is exactly why sampling is unavoidable.
- **Thin rounded frame over a translucent nameplate chip (attempt 3).** Killed the
  rectangle but couldn't give a *solid* backplate, and the chip's legibility still
  varied with the terrain behind it. Replaced first by a solid block chip, then by the
  current translucent pill.
- **Solid 3-row dark name-tag chip (`nameplatePlate` fill, bevelled `▟▙▜▛` corners).**
  The previous iteration: maximally legible (dark plate, bright cosmetic name, ~5:1),
  and a solid chip has no frame/fill seam to bleed. But a 3-row opaque block reads as
  *too chunky* — it stamps a heavy rectangle that dominates the Avatar it labels.
  Replaced by a shorter 2-row pill that is translucent over terrain (so the world reads
  through it) and absent off terrain.
- **Solid nameplate chip in the *cosmetic* colour with dark text.** A vivid badge, but
  a solid bright pill is loud over the scene. The translucent cosmetic-colour wash keeps
  the player's identity colour while sitting much quieter.
- **Give the bubble the nameplate's solid-chip treatment.** Fine for a short Handle; a
  solid opaque chip blots out a large rectangle for a multi-line bubble, so the bubble
  keeps the frosted, terrain-revealing backing instead.

## Consequences

- Shared (`render.ts` / `sceneStyle.ts`): `drawNameplate` takes the `terrain` and
  samples **every** pill cell (the body draws only where ground is below). `nameplate`
  is the full-opacity handle colour; the old solid `nameplatePlate` is gone, replaced by
  `nameplateWash` (default pill colour) and a `cosmetics.nameplateWashes` catalog, both
  prebuilt at `NAMEPLATE_WASH_ALPHA` because the generic renderer can't compute alpha.
  Colours still live in shared `SCENE_COLORS`, so `forge zone preview` stays WYSIWYG
  (#56).
- Client (`playfield.ts` / `theme.ts`): `drawOverheadBox` (and `drawSpeechBubble` /
  `drawEmote`) take the `terrain` and sample per cell; `bubbleShade` is the dark ink
  for the `▒`, `bubbleBg` the ~50% behind-text backing. Both the Speech bubble and the
  Emote change, since they share the box.
- The pill's `NAMEPLATE_WASH_ALPHA`, the bubble's ~50% backing, and the `▒` density are
  judgement calls tuned against solid ground; eyeball them in a real terminal.
- Tests: the nameplate tests assert the 2-row pill shape, that over terrain the pill is
  the cosmetic wash with the handle at full opacity on top, and that off terrain the pill
  body is omitted entirely (only the handle glyph is drawn).
- The inline #103 comments on the nameplate colours (in `render.ts` and `sceneStyle.ts`)
  and the bubble comment in `theme.ts` point here, so the "opaque so terrain can't
  bleed through" rationale no longer reads as current.
