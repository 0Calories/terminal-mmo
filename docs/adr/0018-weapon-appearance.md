---
status: accepted, amended by ADR 0036 (windup/active/recovery named frames →
  one exactly-3-frame `swing` animation indexed by attack phase)
---

# Weapon appearance: always-anchored animated weapon sprites

ADR 0017 §14 wired a Weapon Item into combat (a replicated sprite id, a per-phase
composited sprite/trail, a stat block) and §13b sketched **slash-arc** rendering.
The first cut realized those as a thin overlay: a single accent glyph plus a
`╱`/`╲` **fill of the whole melee hitbox**, both painted *only while a swing is
active* and gone the instant the swing ends. The result reads wrong on two counts.
First, an equipped weapon vanishes between swings — you cannot see what anyone is
wielding while they stand, walk, or jump, so the weapon is not part of the Avatar's
identity, only a transient attack flash. Second, the box-fill slash is a legacy
placeholder: it floods every hitbox cell with one diagonal, which reads as a smear
of noise rather than a swung blade.

This ADR makes the equipped weapon a **permanent, anchored, animated layer of the
Avatar** — present whenever equipped, posed at rest, and sweeping through authored
frames on attack — and retires the hitbox-fill slash in favour of a blade that
visibly traces its own arc. It refines ADR 0017 §13b/§14 and reuses the appearance
architecture of ADR 0003 (decorative sprites decoupled from the logical box) and
ADR 0016 (composited overhead/anchored layers); it does **not** touch the shared
simulation or the wire protocol — every decision here is client-side realization
of state ADR 0017 already replicates.

This ADR covers **appearance only**. It assumes the combat/weapon *foundation* from
ADR 0017 §1/§10/§14 as a prerequisite: the three-phase swing machine
(`swingPhase`/`swingProgress`), the replicated `Entity.weapon` index + weapon
catalog, and the per-entity **action-state** in the snapshot (so observers render
the same weapon and swing the owner does). That foundation is a separate slice; if
it is re-established from scratch, its still-good pieces (catalog, phase functions,
wire field) are harvested there, not here.

## Decisions

1. **The weapon is a permanent posed layer of the Avatar, not an attack overlay.**
   Whenever a Weapon is equipped, its sprite is composited onto the Avatar **every
   frame** — at rest, walking, jumping, and attacking alike — exactly as the
   cosmetic hat is. Idle is a *hold* pose, not the absence of a weapon. There is one
   weapon code path; "attacking" only changes which frame of that path is selected.
   Because the weapon rides the replicated `Entity.weapon` + action-state, observers
   always see what you wield and watch your swing, not a local-only flash.

2. **A weapon is a `WeaponSprite` — a dedicated animated sprite type.** The existing
   single-frame `Sprite` (player, monsters, hats) is left untouched; only weapons
   animate today, so a focused type carries the new shape rather than generalizing
   `Sprite` for a need nothing else has. A `WeaponSprite` is a named frame set —
   `idle`, `windup`, `active` (an ordered sweep of frames), `recovery` — each frame
   an authored glyph+colour grid like any sprite, plus a **grip anchor** and an
   **accent** (§4, §6). Weapon art lives in `packages/shared/src/sprites/weapons/`;
   the `weapons.ts` catalog entry references the `WeaponSprite` alongside its swing
   durations and stat block.

3. **Placement is a data-driven grip anchor, mirrored by facing.** The body template
   declares a named **grip cell** (a hand position), the way it already declares a
   head cell for the hat; the `WeaponSprite` declares its own grip cell; compositing
   aligns grip-to-grip. Facing-left mirrors the anchor and the weapon art across the
   body, reusing the existing facing-mirror path. No weapon placement lives as magic
   offsets in imperative draw code, so a future multi-row body template (the ADR 0003
   ~5×7 target) repositions the grip in data without touching weapon art. The weapon
   layer draws **on top of** the body (composited over the character).

4. **Frame selection is a pure shared function of `(move, phase, swingProgress)`.**
   `idle`, `windup`, and `recovery` are single poses selected by phase; the `active`
   phase plays a **fixed-length sweep** sampled by `swingProgress` (0..1), so the
   blade is seen moving through its arc during the one window the eye is on it.
   Sweep length is fixed per the engine, not per weapon — **heft comes from phase
   *durations*** (already in each weapon's stat block: a greatsword plays the same
   sweep slow and heavy, a dagger flicks through it), not from authoring more frames.
   The selection function is pure and shared so the owner's prediction and every
   observer's render agree on the weapon's appearance frame-for-frame.

5. **Retire the `///` hitbox-fill; the swing is three cooperating layers.** The
   box-fill of `╱`/`╲` across the melee hitbox is deleted — the hitbox returns to a
   purely logical concept, never drawn. A swing now reads from three layers moving
   together: (a) the **blade** (the `WeaponSprite` active sweep, §4); (b) a
   **blade-edge arc** — a short, fading smear of curve glyphs that traces the blade
   *tip* through its arc (not a rectangle flood), so the eye perceives speed and
   direction; and (c) the **motion trail**, the existing `WEAPON_TRAILS` ParticleType
   (`heavy`/`light`), retained as a separate particle layer. The edge-arc is authored
   as part of the weapon's animation, not as a combat overlay pass.

6. **A single per-weapon accent colour drives blade, arc, and trail.** Replacing the
   global `C.melee`, each weapon defines one **accent** colour fed into the blade
   highlight, the blade-edge arc, and the motion trail, so a weapon reads as a
   distinct object even at rest. Today the accent is hand-authored per weapon; this
   is the **rarity-ready seam** — when loot rolls rarity tiers (CONTEXT: *rarity is
   shown as colour*), the tier colour flows into the same accent channel with no
   rework. The weapon's structural palette (grip, guard) stays authored on the sprite
   like any art; the accent is the one dynamic channel.

## Considered and rejected

- **Keep the weapon as a swing-only overlay, just always-draw a "rest" glyph too.**
  Two passes (a rest draw + the existing swing overlay) with a handoff between them
  duplicates state and invites the rest pose and the swing pose to disagree. One
  posed layer with idle as a frame is strictly simpler and is what makes the weapon
  part of the Avatar rather than a bolted-on effect.

- **Generalize `Sprite` to carry frames so everything can animate.** YAGNI: only
  weapons animate now. Generalizing complicates the single-frame path that the
  player, every monster, and every hat depend on, to serve a need that does not yet
  exist. A dedicated `WeaponSprite` keeps the common path trivial; if monsters or
  Avatars later need animation, that is its own decision with its own evidence.

- **A single rotating accent glyph instead of an authored multi-frame sprite.** One
  character reads as a speck beside the multi-row body and cannot express heft or a
  readable blade direction. The whole point of "always visible and impressive" is a
  weapon with silhouette and motion, which in a cell grid means authored frames.

- **Per-weapon sweep frame *count* for heaviness.** Tempting, but it doubles the
  authoring axis and fights the stat block, which *already* dials feel through phase
  durations. Fixed sweep length + variable phase duration gives heavy-vs-fast for
  free and keeps "author a weapon" a known, bounded job.

- **Replace the box-fill with nothing (blade frames alone).** A blade that jumps
  between sweep frames with no trailing arc reads as a teleporting glyph; the eye
  needs the edge-arc and trail to perceive a *swing*. The fix for the legacy slash is
  to make the arc *trace the edge*, not to remove arcs entirely.

- **Fold this into the foundation PR (#177) so weapons merge visually complete.**
  The functional foundation (phase machine, replication, stat-driven feel) and the
  appearance system have different risk profiles — netcode/determinism vs. pure
  client art — and are independently reviewable. Bundling them makes one
  unreviewable PR. Kept as separate slices; this ADR is appearance-only and names the
  foundation as its dependency.

## Consequences

- **New client appearance subsystem (realization only).** A `WeaponSprite` type, a
  weapon-art directory, a pure `(move, phase, swingProgress) → frame` selector, and a
  compositing pass that draws the weapon on top of the body at the mirrored grip
  anchor. All client-side, all driven by authoritative state already on the wire —
  nothing here touches the shared sim or the snapshot format (refines, not qualifies,
  ADR 0006).

- **Body template gains a grip anchor.** The player sprite template declares a named
  grip cell beside its existing head cell; the facing-mirror path extends to the
  weapon layer. Future body templates set the grip in data.

- **`drawSwing`/`swingPose` are reworked.** The single-accent-glyph + hitbox-fill
  implementation from the foundation cut is replaced by the three-layer swing
  (blade sweep + edge-arc + trail). The `╱`/`╲` melee box-fill and the global
  `C.melee` swing colour are removed; the melee hitbox is no longer drawn.

- **Weapon catalog entries grow an appearance block.** Each `weapons.ts` entry
  references a `WeaponSprite` and an accent colour alongside its existing swing
  durations and stat block. `WEAPON_TRAILS` is retained and tinted by the accent.

- **Rarity-ready colour channel.** The per-weapon accent is the single seam loot
  rarity feeds later; no further appearance rework is needed when tiers land.

- **Vocabulary.** CONTEXT.md gains `Weapon sprite`, grip anchor, blade-edge arc, and
  weapon accent.
