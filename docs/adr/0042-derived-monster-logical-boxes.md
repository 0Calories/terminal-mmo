---
status: accepted, partially supersedes ADR 0003 (uniform logical box for
  server-controlled catalog entities; its presentation decoupling stands)
---

# Monster and NPC logical boxes derive from their sprite's Default frame

ADR 0003 hard-decoupled the decorative Sprite from a small uniform logical
footprint, and for years every entity — Avatar, Monster, NPC — shared the one
`BOX`. The art then grew apart from it: the slime is a squat 7×4, the brute a
towering 7×6, the merchant a 6-wide counter figure, all standing on a 5×5 box
that matched none of them. The damage-number spawn bug was the symptom that
exposed the drift — hit markers spawned at the *uniform* box centre, visibly
off-body for exactly the monsters whose art had outgrown it — and every fix
inside the uniform-box model was a patch over the same widening gap: hurtboxes
that miss the visible body, feet planted by off-by-a-cell constants, loot
popping out of a slime's forehead.

## Decision

For **server-controlled catalog entities — Monsters and NPCs — the entire
logical box (hurtbox and terrain-physics footprint) is derived from the
sprite art**: the visible (non-transparent) pixel bounds of the sprite's
**Default frame** (frame 0 of the first Animation, ADR 0037). This supersedes
ADR 0003's uniform-logical-box clause for those entities only. Its deeper
philosophy stands unchanged: presentation stays decorative and client-side,
the simulation still knows nothing but position + box — one *number* per type
now simply comes from the art instead of a shared constant.

Boundaries that are not up for derivation:

1. **Avatars keep the canonical uniform `BOX`.** ADR 0020's guarantee —
   cosmetics and Forms never change gameplay — would die the moment a Form's
   art sized its hurtbox. Nothing is ever derived from Form art; the
   registration seam is keyed through the monster/NPC sprite references, so
   the Avatar box is unreachable by construction.
2. **Attack hitboxes stay authored.** Strikes, swing reach, skill arcs, and
   Projectile hitboxes remain COMBAT constants and combat-engine specs. Only
   the entity's *own* box is derived — an attack anchors off that box's edge,
   but its reach never comes from art. (The slime pounce is unchanged in
   spirit: its leaping *body* was always the hitbox, and that body is now the
   derived box.)
3. **One box per sprite, from the Default frame only.** Not the grid (grids
   may pad), not a union across frames, not per-frame dynamic. Squash and
   stretch are drawn *within* the grid; `sprites:check` errors when any frame
   resizes the grid away from the Default frame's and warns when a frame's
   visible art wildly overhangs the Default extent.

Mechanics:

- **Computed at asset load in `@mmo/assets`** from the raw sprite text and
  handed to `@mmo/core` as plain per-type box dims at catalog-registration
  time (`registerSpriteBoxes`, called before the first zone parse). Core
  never parses sprite art; the server still sees no sprite *code* (ADR
  0030/0033) — the derivation is a text scan behind the `/meta` door, and
  `sprites:check` proves it agrees with the real parser's view of the same
  frame. Client and server run the identical derivation, so prediction
  cannot diverge.
- **Authored zone slots keep their meaning.** A spawn or NPC glyph still
  marks the old uniform-sized slot; the derived box is centred in it with
  feet kept on the slot's floor, so existing zones stay valid and entities
  neither sink nor float at spawn. Physics, hurtboxes, combat-event centres
  (per-entity box centres now), projectile muzzles, loot drops, wall/ledge
  probes, render planting, and depth ordering all read the per-type box.

## Considered and rejected

- **Derive the hurtbox only, keep the uniform physics footprint.** Two boxes
  per entity to reason about, and every "which box?" call site is a fresh
  bug. The world is small and hand-eyeballed; terrain fallout from honest
  footprints is manageable, so one box wins.
- **Per-frame dynamic boxes.** Re-couples animation to gameplay frame by
  frame — the exact coupling ADR 0020 and the phase-progress sampling rules
  exist to prevent. A wind-up squash must be a telegraph, not a hurtbox
  shrink.
- **Union of all frames' visible bounds.** Attack lunges and stretches would
  permanently inflate the box, punishing expressive animation with a fatter
  hurtbox.
- **Derive Avatar boxes from Form art.** Violates ADR 0020's
  cosmetics-neutrality outright: picking a slimmer Form would be a gameplay
  buff.

## Consequences

- Monster feel shifts slightly and deliberately: the slime is a low, wide
  target a swing can clear over less easily but a short gap can admit; the
  brute reads (and blocks) as tall as it looks; the chaser's hurtbox matches
  its silhouette. Manual QA eyeballs the demo world for regressions.
- `sprites:check` gains the uniform-grid error, the overhang warning, and
  the derivation-parity error; a monster sprite that resizes its grid is
  refused at load, not silently mis-boxed.
- CONTEXT.md's **Sprite** entry drops "deliberately decoupled from the
  entity's … footprint" in favour of the split truth: decorative
  presentation, but a Monster's logical box derives from its Default-frame
  art; an Avatar's box stays canonical.
