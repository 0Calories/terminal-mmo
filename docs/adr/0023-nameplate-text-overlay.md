---
status: accepted
---

# Nameplates: bare Handle text on a tinted backing, drawn as a top layer below the feet

Planting feet on terrain (ADR 0021) shifted the buddy sprite down one cell via a
per-sprite `baseline`, but the nameplate still anchored to `e.y + BOX.h` — the row
the feet now occupy — so the pill collided with the sprite and the terrain surface
(the name buried in the platform / overlapping the body). Fixing the offset was the
trigger; we took the opportunity to retire the translucent **pill** of ADR 0016,
which the planted-feet world made fragile, and replace it with a simpler model.

## Decisions

- **The name stays *below the feet*, not above the head.** Above-the-head was
  considered and rejected: the head is contested airspace. Hat height is variable
  (a top-hat vs. bareheaded moves "above the head" by several cells, so the label
  would have to measure the tallest composited cell every frame — the exact problem
  the team escaped when #103 first moved the chip below the feet), and the Speech
  bubble / Emote box already anchors above the head (`top - 2`), so a name there
  would fight the bubble every time someone talks. Below the feet, the only contender
  is terrain, and **bubbles-above / names-below means the two never spatially
  collide** — a clean separation worth keeping.

- **Anchor at `e.y + BOX.h + baseline`.** The name reads the same `baseline` the
  sprite does (Form-level for BodySprites, else `sprite.baseline`), so it tracks the
  planted sprite down instead of being overrun by it. The label is now a **single
  row** of glyphs (the old 2-row pill's bottom lip is gone).

- **No pill.** The bevelled corners (`▟▙`), side padding, bottom lip (`▝▀▘`), and the
  per-cell terrain-sampled colour *wash* are all removed. The label is just the
  Handle letters on a backing.

- **Readability via an always-on per-glyph backing, tinted by the cosmetic
  nameplate colour.** Each letter cell gets an **opaque, ~30%-darkened** version of
  the player's nameplate colour as its background, with the bright full-colour
  nameplate ink letter on top. Unconditional — it does not sample what's behind —
  because as a top layer (below) a name can now land over bright terrain, a bright
  co-present sprite, *or* sky, and only a backing that ignores the underlying cell
  stays legible over all three. The tint (dark-maroon strip under bright-red letters,
  etc.) ties the label to the player's cosmetic identity, the same goal the old wash
  served. This is the inverse of the bubble's *neutral* dark backing (ADR 0016) — the
  nameplate is an identity tag and wants the hue; the bubble is a message panel and
  wants neutrality.

- **Names are a true top layer, composited by the caller.** `renderZoneScene` no
  longer draws nameplates — it draws sprites only. A shared
  `drawNameplates(buf, entities, cam, terrain, style)` pass holds the one copy of the
  label logic, and **each caller invokes it at the z-order it wants**: the live client
  runs it *after* the local Avatar and all combat FX, just before the Speech-bubble
  pass (so a co-present name is never occluded by the local Avatar standing in front);
  the forge-preview / headless path runs it immediately after `renderZoneScene`.
  Z-order is a compositing concern, so it belongs to the compositor, not the scene
  renderer. `render.test.ts` calls the new pass directly.

- **No self-nameplate.** The local Avatar still has no name drawn (the camera is
  centred on it; you know which one is you). The new pass makes adding one a one-liner
  if that ever becomes desirable, but it is out of scope here.

## Consequences

- The wash machinery dies: `cosmetics.nameplateWashes`, the default `nameplateWash`,
  the `wash()` helper, and `NAMEPLATE_WASH_ALPHA` are removed from `RenderStyle` /
  `buildSceneStyle`. They are replaced by a parallel `cosmetics.nameplateBgs` catalog
  (each `NAMEPLATE_COLORS` entry passed through a new `darken()` helper) plus a
  default `nameplateBg`. The opaque ink catalog `cosmetics.nameplates` is unchanged.
  As with the washes, these are prebuilt in `buildSceneStyle` because `@mmo/core` is
  generic over the colour type `C` and can't derive a darker variant from an opaque
  `C` at draw time.

- This **supersedes the nameplate-pill decisions of ADR 0016** (the 2-row translucent
  pill, the per-cell terrain-sampled wash, and the `nameplateWashes` catalog). ADR
  0016's analysis of *why terrain is a foreground block* still stands, and its
  **bubble + emote** decisions (`drawOverheadBox`, frosted `▒` body, neutral dark text
  backing) are untouched — only the nameplate half of that ADR is replaced.

## Considered and rejected

- **Move the name above the head.** The natural MMO convention and it sidesteps the
  terrain entirely, but it re-introduces variable hat-height measurement and collides
  with the Speech bubble's airspace every time a player chats. Below-the-feet keeps
  names and bubbles in disjoint bands.

- **Keep the pill, just add `+ baseline`.** The one-line regression fix. Rejected
  because the planted-feet world (name sitting *on* the lowered terrain surface)
  made the translucent-wash-over-terrain trick even more fragile, and the pill was
  already the chunkiest part of the overhead UI; the redesign is barely more code and
  removes a whole sampling branch.

- **Neutral (un-tinted) dark backing.** Simpler and slightly crisper contrast
  (brightness *and* hue differ between ink and backing). Rejected by preference: the
  tinted backing carries the player's cosmetic identity, matching what the old wash
  was for.

- **Conditional backing — bare text over sky, backing only over bright terrain.**
  The lightest "just floating text" look, but as a top layer the name can overlap a
  bright *sprite* off-terrain, where terrain sampling sees nothing and the letters
  wash out. The always-on backing is content-agnostic and strictly less code.
