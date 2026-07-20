---
status: accepted, amended by ADR 0035 ("pose" → "animation"; walkA/walkB merged
  into one distance-indexed `walk` animation)
---

# Animated body sprites, Forms, and pose-driven emotes

The Avatar's body is a single static **Sprite**: one glyph grid, mirrored by facing,
unchanged whether the Avatar stands, runs, jumps, or swings. Only the **Weapon
sprite** animates (ADR 0018), so a sprinting Avatar slides on a frozen pose, a swing
moves the blade but not the body, and there is no way to wave or sit. ADR 0003 always
named the target — "MVP animation = a small fixed pose set (idle / walk / jump /
attack) × facing, hand-authored" — but it was never built; ADR 0018 deliberately
deferred it ("Generalize `Sprite` to carry frames? YAGNI: only weapons animate now").
The evidence that retires that YAGNI now exists: we want walk, emote, and (later)
combat body motion.

This ADR makes the body an **animated, posed layer** the same way ADR 0018 made the
weapon one, and introduces **Form** — a cosmetic appearance identity a player picks,
a *variation within the shared humanoid body plan* (build, silhouette, physical
quirks — players are always humanoid, never a different creature) — as the unit that
owns a body's pose set. It also retires a placeholder: the existing overhead-glyph **emote**
(a face popup drawn in a Speech-bubble-style box) is deleted, and "emote" is redefined
to mean a body animation the Avatar itself performs. Like ADR 0018, this is an
**appearance** change built on state ADR 0017 already replicates; it adds one small
field to the per-entity action-state (the active emote) and otherwise touches no sim.

## Decisions

1. **The body is a `BodySprite` — a named, whole-frame pose set, posed every frame by
   a pure function of replicated state.** Mirroring the `WeaponSprite` shape (ADR 0018
   §2), the player graduates from single-frame `Sprite` to a `BodySprite`: a map of
   named frames (`idle`, `walkA`, `walkB`, `jump`, `windup`, `active`, `recovery`,
   `hurt`, plus one frame set per emote), each an authored glyph+colour grid with the
   existing free left/right mirror. The frame is chosen by a pure, shared selector
   `(form, move, phase, walkPhase, emote, airborne, …) → frameId`, so owner prediction
   and every observer's render agree, exactly as the weapon frame does. `BodySprite`
   is **entity-agnostic by design, not player-specific**: Monsters are a known future
   consumer (they already replicate phased-attack action-state per ADR 0017, so the
   same selector drives their `windup`/`active`/`recovery` poses when authored) — they
   keep single-frame `Sprite` only *for now*. Hats stay single-frame `Sprite`
   permanently; they don't animate.

2. **A pose is a *whole frame*, not a composited skeleton.** At terminal fidelity a
   limb is one or two cells; there is nothing to rotate, so "animate the leg" *is*
   "redraw the feet row." A whole-frame pose set reuses the one render path the weapon
   already proves, keeps mirroring free, and makes a **Form** a flat bag of grids
   (data, not code). Genuinely separable objects — Weapon, hat — remain anchored
   overlays (ADR 0018 §3), which is the one place compositing earns its cost.

3. **Form is cosmetic-only: appearance varies, the logical box never does.** A Form
   changes *only* the `BodySprite` — build, silhouette, and physical quirks, all
   within the shared humanoid body plan (players are always humanoid). Every Avatar
   keeps the **same logical collision box and the same stats and combat numbers**,
   leaning on ADR 0003's decoupling of the
   decorative sprite from the ~1×2 logical footprint. This keeps platforming fair
   across Forms and keeps Forms a pure-art concern with zero balance design. A
   gameplay-bearing race (stats/abilities) is explicitly *not* this — it would be its
   own ADR and milestone.

4. **Forms live in a registry keyed by a `cosmetics.form` index, riding the existing
   appearance rails.** A `FORMS` array of `BodySprite`s sits beside `HATS`; selection
   joins hue/hat/nameplate as a fourth `Cosmetics` index, replicated in the same
   3-bytes-of-indices appearance payload (ADR 0006). Because grip/head anchors are
   declared per body (ADR 0018 §3), an equipped weapon and a hat composite correctly
   onto *any* Form for free, and hue-recolour keys work on any Form's art.

5. **Per-Form authoring contract: a required core, everything else idle-fallback.**
   Each Form **must** author `idle`, `walkA`, `walkB`; every other named frame is
   optional and falls back to `idle` (or the nearest required frame) when absent. A
   new Form is usable after ~3 grids and can be made more expressive later — the lever
   that keeps adding Forms cheap rather than a per-Form full-frame-set obligation.

6. **The pose selector is a fixed precedence ladder:** `hurt/stagger > combat (windup
   /active/recovery) > airborne > walk > emote > idle`. The one deliberate choice is
   that **walking cancels an emote** — an emote is a "standing still and posing"
   moment, not something you do mid-stride — which keeps emote frames from needing to
   read over moving feet.

7. **The walk cycle is driven by accumulated horizontal distance, not a clock.**
   `walkA↔walkB` flips every `STRIDE` cells of travelled |Δx|, freezing when idle or
   airborne. Gait derives from position, which is *already* replicated, so it costs no
   new wire data, auto-syncs cadence to speed (a sprint takes quicker steps for free),
   and the owner and every observer compute the identical foot frame-for-frame. A
   wall-clock or render-clock walk would desync observers (who see others ~100ms in
   the past via interpolation) and was rejected for that reason.

8. **"Emote" is redefined to a body animation; the overhead-glyph emote is deleted.**
   The shipped `love/laugh/cry/angry` face-glyph popup (a Speech-bubble-style box on
   the telegraph layer) was a placeholder and is removed wholesale — its catalog,
   `drawEmote`/overhead-box path, the client `emotes` map + decay, the `Entity.emote`
   glyph field, and the **server→client `emote` relay** message. Henceforth an **Emote
   ** is a pose the Avatar's own body performs. Each emote declares a **lifetime
   mode**: `oneshot` (plays once for a duration, then returns to idle — e.g. `wave`),
   `loop` (cycles until interrupted — e.g. `dance`), or `hold` (a single sustained
   pose — e.g. `sit`). The launch set is `wave`/`dance`/`sit`, one of each mode.

9. **Emote state is replicated in the per-entity action-state, not as a fire-and-
   forget event.** The active emote (`emoteId` + `emoteT`) joins the snapshot action-
   state (ADR 0017 §10), so an observer who arrives *after* an emote begins still sees
   a held `sit` or a looping `dance` — which the old event-relay channel could not
   express. The trigger keeps the existing `/em`/`/emote <id>` chat command
   (`/emotes` lists the set); only its meaning changes. The local Player predicts their
   own emote immediately; movement or combat clears it per the precedence ladder.

## Scope this pass

Ship **one** new humanoid Form as `FORMS[0]` (9×3 — the current footprint, so
world-scale is unchanged); the registry and selector are Form-keyed so a second Form
is pure data later. Author the required core plus a single `jump`/airborne pose.
**Deferred**, with seams left open: the Form **picker UI** and its `cosmetics.form`
wire byte (only one Form exists, so it defaults); **combat body leans** (`windup`/
`active`/`recovery` body frames — combat stays weapon-only, body holds `idle`); the
**hurt** pose (the existing hurt-flash colour override stands); additional Forms;
appearance **persistence** (Forms re-pick each launch, like cosmetics today); and
**Monster animation** (Monsters keep single-frame `Sprite` until they adopt
`BodySprite` with a per-Monster pose vocabulary — its own later slice).

## Considered and rejected

- **Skeletal / per-part body compositing.** Decompose the body into anchored
  head/torso/arm/leg parts and transform them per frame. At one-to-two cells per limb
  there is nothing to rotate, so it collapses back into redrawing the grid while
  paying for joint math and per-part bookkeeping — for no payoff at this resolution,
  whether the consumer is a Form variation or a future animated Monster. Whole-frame
  poses win precisely *because* the fidelity is low, and they reuse the one render
  path the weapon already proves.

- **Keep ADR 0018's YAGNI and leave the body static.** That call was right when only
  weapons animated; the need it waited for (walk/emote/combat body motion) is now the
  feature. We honour its narrower form — hats stay single-frame `Sprite`, and Monsters
  stay so until their own animation slice; the player body, which has the evidence
  now, graduates to `BodySprite` first and proves the type for Monsters to follow.

- **Make Forms carry gameplay (stats/abilities).** That is a balance and progression
  project that dwarfs the sprite work and would gate this art change behind meta
  design. Forms are deliberately cosmetic; a gameplay race can be a later ADR if ever
  wanted.

- **Reuse the old event-relay emote channel for body poses.** It is fire-and-forget,
  so a `hold`/`loop` emote would be invisible to anyone who arrives after it starts.
  Persistent poses need persistent replicated state, which is why the emote joins the
  action-state.

- **Advance the walk cycle on a wall-clock / render clock.** Simple for the local
  Avatar, but other Avatars (rendered interpolated in the past) would desync their
  feet from the owner's. Distance-driven gait is deterministic and free on the wire.

- **Rename the existing overhead popup to "reaction" and keep it.** The popup was a
  placeholder we are removing, not a feature to preserve; keeping both would split one
  word across two systems and two replication models for no product reason.

## Consequences

- **New `BodySprite` type and a pure pose selector.** A named-frame body type beside
  `WeaponSprite`, a `FORMS` registry, and a shared `(form, move, phase, walkPhase,
  emote, …) → frameId` function. The body draw path selects a frame instead of always
  drawing the one grid; weapon/hat compositing over the body is unchanged.

- **`Cosmetics` gains a `form` index (wire byte deferred).** The type and registry
  exist now; the picker field and the fourth appearance byte land when a second Form
  ships. Until then the Avatar uses `FORMS[0]`.

- **Action-state gains an active-emote field.** `(emoteId, emoteT)` join the per-
  entity action-state in the snapshot (ADR 0017 §10); the walk cycle adds nothing to
  the wire. No other sim or protocol change.

- **The overhead-glyph emote system is removed.** Catalog, render path, client map +
  decay, `Entity.emote` glyph field, and the `emote` *server→client* relay message all
  go; the `/em`/`/emote` *client→server* trigger is retained and repointed at the new
  emote state. The `emote come later` aside in CONTEXT's **Chat** entry is now
  satisfied by a different mechanism than the deleted one.

- **Vocabulary.** CONTEXT.md gains **Form**, **Body sprite**, **Pose**, and **Walk
  cycle**, and **Emote** is (re)defined as a body animation.
