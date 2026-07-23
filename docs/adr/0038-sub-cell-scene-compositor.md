---
status: accepted
---

# Compose the playfield in sub-cell pixels before encoding terminal cells

Sprites are authored as four quadrant Pixels per terminal cell, but the renderer
currently writes each layer straight into OpenTUI as one glyph, foreground, and
background. That collapses transparent quadrants too early: a later glyph can blend
with only the stored background channel, not the visible foreground shape beneath
it. We will instead compose the whole imperative playfield in a terminal-neutral
sub-cell surface and encode terminal cells once, after every world layer is drawn.

## Module seams

`@mmo/render` becomes three deep directory modules with curated subpath exports:

- `compositor` owns a concrete RGBA model, reusable flat Pixel buffers, alpha
  composition, Glyph overlays, clipping, colour reduction, and terminal-neutral
  cell output. OpenTUI, text, and headless adapters consume that output; the module
  does not depend on OpenTUI.
- `sprites` owns Sprite format v2, validation, compilation, runtime Pixel/Glyph
  frames, and registries. The file format stays unchanged; quadrant cells compile
  once into four Pixels and arbitrary characters into Glyph stamps.
- `scene` owns shared terrain and actor drawing, styles, and visual culling.

Domain entities remain data-only records in `@mmo/core`. Presentation concerns own
focused draw functions and draw into the shared compositor; entities do not gain
render methods or wrappers. The client playfield owns visibility context, explicit
pass ordering, and orchestration. A module may privately skip clearly off-screen
work using visual bounds it already knows, while the compositor clips every write;
correctness never depends on coarse culling.

All rendering consumers move to this seam: the live client, Forge zone preview and
playtest, Sprite composited preview, character/customization previews, CLI dumps,
and headless tests. The direct `CellBuffer` path is deleted rather than retained as
a compatibility renderer.

## Composition rules

- The compositor stores four Pixels for every terminal cell. Translucent visuals
  use 8-bit sRGB source-over composition against the actual composed Pixels beneath
  them. Opaque Pixels replace what is beneath them.
- A terminal cell can carry only two colours. When composition exposes more, colour
  candidates survive in front-to-back order and lower Pixels map to the surviving
  colour with the smallest squared-RGB distance. Stable RGBA ordering resolves the
  final tie.
- A Glyph stamp is an atomic cell representation. Without an authored background,
  it takes the colour covering the most underlying Pixels; equal coverage prefers
  the rearmost colour, then stable RGBA order. An authored background stays opaque.
- The frontmost representation owns a cell. A front Glyph replaces a lower Pixel
  glyph; front Pixel content replaces a lower Glyph and retains only its flattened
  backdrop. Font-shape-aware merging is impossible to do consistently across
  terminal emulators.
- Sprite Glyph stamps must occupy exactly one terminal column. Dynamic world text
  is grapheme- and display-width-aware instead: a two-column grapheme is one atomic
  overlay across two cells, and Speech bubbles wrap by displayed columns.
- The compositor is the sole source of backdrop truth. Sprite planting, Speech
  bubbles, and other modules no longer sample Terrain or guess whether sky or ground
  is underneath; transparent and translucent primitives reveal the composed scene.

## Placement and order

Pixel-authored visuals can translate by one Pixel, or half a terminal cell, on both
axes. The camera and Camera-kick use the same resolution. The transform quantizes
the combined world-relative offset once, avoiding independent camera/entity
rounding. Glyph-authored visuals remain cell-snapped.

Movement-capable Sprite roles (form, hat, weapon, and monster) are Pixel-only so an
assembled actor moves as one coherent image. The few incompatible shipped cells
(the party hat's `▲` and sword swing's `▂`/`▔`) are redrawn as quadrant art. Particle
profiles may choose Pixel or Glyph primitives; Pixel particles follow their
half-cell position and Glyph particles snap to the nearest cell.

The playfield owns these explicit back-to-front passes:

1. Terrain.
2. World-floor visuals: Portals, Drop glyphs, settled Particles, and dodge echoes.
3. NPCs, Monsters, and remote Avatars, sorted by logical foot depth. Equal depth is
   deterministic by actor category and stable id, preserving NPC-behind-entity
   behaviour. Each actor's body, weapon, and hat draw atomically.
4. The local Avatar, preserving its deliberate top-of-crowd rule.
5. Combat visuals: swings, guards, skill telegraphs, airborne Particles, and
   Projectiles.
6. Identity, Drop, and interaction labels.
7. Speech bubbles.

This keeps combat readable over sprites and communication readable over combat.

## Performance and verification

The live client defaults to 60 FPS; `MMO_FPS=120` remains an opt-in high-refresh
setting. The compositor reuses flat buffers and does not allocate one object per
Pixel. A crowded real-terminal stress scene must sustain at least 60 FPS, with a
target composition/encoding cost around 4 ms for a representative viewport. Timing
benchmarks are opt-in because CI timing is noisy.

CI uses colour-aware semantic tests for transparent identity, opaque overwrite,
source-over alpha, two-colour reduction, Glyph backdrops, representation precedence,
half-cell translation, deterministic actor order, clipping, and pass order. Real
Sprite overlap scenarios assert final glyph, foreground, and background. The one
broad character golden remains the whole-scene review artifact; real-terminal checks
cover font rasterization and motion.

## Migration

1. Build the compositor, output adapters, and pure tests without changing production
   rendering.
2. Restructure `@mmo/render`, compile Sprite primitives, migrate every caller while
   still cell-aligned, establish the new passes, and delete direct buffer drawing and
   manual backdrop sampling.
3. Redraw incompatible moving Sprite stamps and enable half-cell actors, camera, and
   Camera-kick.
4. Add width-aware world text and Pixel/Glyph Particle primitives, change the default
   to 60 FPS, then run the stress and real-terminal checks.

Each phase lands independently with `bun run ci`; intentional visual changes require
reviewing the golden diff.

## Relationship to earlier decisions

- ADR 0003's rich decorative Sprites, local-Avatar priority, and overlap remain;
  y-order is sharpened to deterministic logical foot depth.
- ADR 0005's imperative playfield and retained chrome seam is unchanged. This is a
  software compositor inside the imperative playfield, not a retained scene graph.
- ADR 0016's frosted bubble appearance remains, but its per-cell Terrain sampling is
  superseded by composition against the actual scene.
- ADR 0021's planted baseline and half-height Terrain surface remain, but its
  `PlantContext` Terrain sampling is superseded by transparent Pixels revealing the
  already-composed Terrain.
- ADR 0023's labels-above-combat and bubbles-above-labels intent is made explicit;
  Projectiles no longer bypass it by drawing last.
- ADRs 0030 and 0032 continue to govern the package split and deep-module subpath
  exports.

## Rejected alternatives

- **Keep writing directly to OpenTUI and improve alpha calls.** OpenTUI retains only
  one glyph/foreground/background tuple, so the underlying foreground shape is
  already lost.
- **Composite each Sprite separately.** Flattening before Sprites overlap recreates
  the same loss at a different seam, and later particles or text can still replace
  the result.
- **Give every entity or Pixel a render strategy.** Domain objects would cross the
  core/render package seam, while a Pixel cannot independently select a terminal
  cell shared with three neighbours. Per-Pixel objects also add hot-path allocation
  without useful variation.
- **Keep a legacy renderer during normal operation.** Two production paths would
  let client, Forge, previews, and tests disagree.
- **Rasterize arbitrary Glyphs to merge their shapes.** Their shape is owned by the
  user's terminal font and cannot be known portably.
- **Use linear-light/perceptual colour conversion.** It changes already-tuned sRGB
  colours for little benefit in a four-Pixel reduction; deterministic sRGB math is
  simpler and closer to current output.
- **Keep 120 FPS as the default.** Normal movement produces about 44 distinct
  half-cell positions per second, so 60 FPS displays the useful spatial updates while
  leaving more budget for composition. High refresh remains available explicitly.
