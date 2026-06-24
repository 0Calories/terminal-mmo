---
status: accepted
---

# CombatEvent: combat resolves into events; effects are their projection

ADR 0013 gave us authoritative **Effects** and client-realized **Particles**, and
said Effects are "emitted in `stepZone()`, exactly at the damage-application sites"
(§1). That rule quietly grew two problems as combat got faster (ADR 0017):

1. **The emit sites are duplicated and have drifted.** The fact "this swing struck
   that target" is decided in *two* hand-written places — the server's monster loop
   in `stepZone` and the client's `predictHitEffects` — that share only the leaf
   `bloodEffect` call. The server gates a hit with the per-swing registry
   `swingHits` (one hit per `(swing, target)`, ADR 0017 §2). The client gates with
   `m.hurtT <= 0`. But a player hit never sets a Monster's `hurtT` — so the client
   gate **never closes**, and the local Player's *predicted* blood + hit-sound fire
   on **every render frame of the active window** (~10–18×) instead of once. That is
   the "rapid-fire noise / particle spam on a single hit" bug. The server's feed was
   always correct (deduped by `swingHits`, and the originator's own Effect is
   suppressed back to them, ADR 0013 §3); the spam is purely the client's
   differently-gated re-derivation.

2. **"Emit at the damage site" conflates two ideas** — *resolving* what happened
   with *presenting* it. The chip-vs-break-vs-death decision and the
   blood/impact/gore choice are tangled into the same inline statements at 13
   separate sites, so there is no single place that owns "given a resolved hit, what
   does it look and sound like."

This ADR introduces the missing concept and refines ADR 0013 §1.

A **CombatEvent** is the resolved, semantic fact of a combat interaction — *"target
T was hit / poise-broke / died / parried, at (x,y), facing →, intensity N"*. It is
distinct from an **Effect** (the presentation descriptor, ADR 0013) and from a
**Particle** (the client realization). The pipeline becomes:

```
combat resolution → CombatEvent → effectsOf() → Effect → ParticleType[] → Particles
                                              ↘ SoundEffect cues
```

```ts
type CombatEventKind = 'hit' | 'break' | 'death' | 'parry' | 'swat';

type CombatEvent = {
  kind: CombatEventKind;
  targetId: number;   // who was struck (Monster, Avatar, or a swatted Projectile) — the subject
  source?: number;    // attacker session, for originator-suppression; absent ⇒ "everyone"
  x: number; y: number;
  dir: -1 | 0 | 1;    // horizontal bias of the blow (0 = radial, per ADR 0013) — matches Effect.dir
  intensity: number;  // damage dealt; drives particle count / sound volume
  tint?: Tint;        // a death only — the dead entity's body colour, projected onto the gore (#139)
};

function effectsOf(e: CombatEvent): Effect[]; // shared, pure (combat.ts)
```

`effectsOf` maps `hit → blood`, `break → impact` (+`poise.max`, heavier), `death → gore`
(tinted), `parry → parry` (fixed intensity), and `swat → impact` (the shot's own damage,
**no** `poise.max` bump — a light clink, distinct from a break; #194).

## Decisions

- **Combat resolves into CombatEvents; Effects are the CombatEvent's projection,
  not emitted ad-hoc.** This restates ADR 0013 §1: instead of "Effects are emitted
  at the damage-application sites," **Effects are the presentation projection of a
  resolved CombatEvent**, computed by one shared pure `effectsOf()`. `effectsOf`
  maps the *semantic* kind to the *presentational* `Effect.kind` (`hit → blood`,
  `break → impact`, `death → gore`, `parry → parry`) and is the single home for
  cross-event presentation rules — e.g. a lethal blow voices death, not death+hit
  (ADR 0014 §2). `Effect.kind` stays presentational; `CombatEventKind` is semantic.

- **State-change *produces* the event on the authority; the client *predicts* it;
  effects are always the event's sole projection.** On the server, applying
  damage/poise is what *decides* the kind — the poise result is what makes a contact
  a `hit` vs a `break` vs a `death`. The local Player, which does not own authoritative
  Monster state, resolves only the **optimistic `'hit'`** CombatEvent from contact
  and projects its blood immediately for zero-latency feel (ADR 0013 §3). `break` /
  `death` / `parry` are **authority-only** and reach everyone unsuppressed (the "big
  moments," ADR 0017 §13c). Damage is *not* a projection of the event — it is how
  the authority computes the event.

- **The overlap + swing-registry gate is a single shared primitive, replacing the
  inert `hurtT` check.** The "which targets does this hitbox newly strike this
  swing?" decision moves into one pure shared function that **both** `stepZone` and
  the client's prediction call, so the two `resolveCombat` consumers can no longer
  diverge. The client mirrors the server's per-swing registry on
  `predicted.swingHits`, cleared on `swingStarted` exactly as the server clears it
  (ADR 0017 §2). This deletes the `m.hurtT <= 0` gate that caused the spam — the
  client now dedups by the *same* registry the server does, so predicted blood +
  hit-sound fire **once per `(swing, target)`**.

- **`CombatEvent` is a shared-internal value, not a wire type.** Effects still ride
  the snapshot exactly as today (ADR 0013 §2); the server projects CombatEvent →
  Effect *before* building each recipient's snapshot, and originator-suppression
  keys on the `source` carried by the CombatEvent (present on `hit`, absent on
  `break`/`death`/`parry`). No protocol change.

- **Scope: define the full vocabulary now, migrate one path now.** The
  `CombatEvent` taxonomy and `effectsOf` contract above cover *all 13* current
  emission sites (player-melee, monster-melee, projectile-vs-monster,
  projectile-vs-Avatar, deaths, parries). The **code change lands only on the
  player-melee → Monster path** — the bugged one — which proves the seam
  end-to-end (server emits a CombatEvent, `effectsOf` projects it, the client
  predicts via the shared gate). The other 12 sites keep their inline emission until
  migrated in follow-ups against this now-documented model. This is a deliberate,
  bounded mixed state, not an oversight.

  **Update (#194): the migration is complete.** The remaining sites — monster-melee →
  Avatar, projectile → Monster, projectile → Avatar, and both deaths — now resolve a
  `CombatEvent` projected through `effectsOf`. No inline `*Effect()` push remains in
  `stepZone`. Avatar-target events stay **server-only** (incoming hurt is never
  predicted, ADR 0013 §3); `break`/`death`/`parry`/`swat` stay source-less. Two
  additions the remaining sites forced: `CombatEvent.tint` (a death carries the dead
  entity's body colour to its gore) and a fifth kind, **`swat`** — a Player's melee
  frame shattering a hostile shot (ADR 0017 §8). A swat resolves against the
  *Projectile* (its position + id, not an entity centre) and projects to a **light**
  `impact` at the shot's own damage, with no `poise.max` bump: it is a clink, not a
  Poise break, so it needs its own kind rather than reusing `break`.

## Considered and rejected

- **A time-based debounce on predicted effects** ("one predicted blood per N ms per
  target"). Invents a *second*, fuzzier rule unrelated to swing semantics, and still
  misfires on legitimate fast re-hits across two swings. The swing registry the
  server already uses is the correct, exact gate.
- **Fold effect emission into `resolveCombat`.** `resolveCombat` is deliberately
  world-blind — one Avatar's intent → hitbox, no Monster list (combat.ts). Folding
  collision in would force every per-Avatar resolve to ingest the whole world and
  conflate *"am I swinging?"* with *"who did I hit?"*. CombatEvent sits one layer
  out, where the world is in scope.
- **Drop local effect prediction; render server-only Effects.** One source of truth,
  but the Player's own blood/sound now lag ~1 RTT — the mushy combat ADR 0013 §3 was
  written to avoid. A feel regression for marginal simplicity.
- **Migrate all 13 sites in one change.** A broad refactor of *authoritative* combat
  (melee + projectiles + monster attacks + parries + deaths) with a large test
  surface; a regression breaks the whole feel layer at once. Staged migration keeps
  each step verifiable.
- **Keep the client gating predicted hits on `hurtT`.** This *is* the bug: the server
  never sets a Monster's `hurtT` on a player hit, so the gate never closes.

## Consequences

- Shared `combat.ts` gains the `CombatEvent` type, the pure `effectsOf()`
  projection, and the shared swing-hit-resolution primitive. `predictHitEffects`
  retires (becomes the optimistic-`hit` path through the shared primitive +
  `effectsOf`).
- The client tracks `predicted.swingHits`, clearing it on `resolveCombat`'s
  `swingStarted`, so its prediction obeys the same `(swing, target)` contract as the
  server — fixing the rapid-fire blood/sound on a single hit.
- `stepZone`'s player-melee → Monster path emits a `CombatEvent` and projects via
  `effectsOf`; the remaining 12 sites are unchanged until migrated (tracked as
  follow-ups). The `Effect` wire type and snapshot shape are untouched.
- The new resolution + `effectsOf` are pure and unit-testable headlessly; a
  regression test asserts that a multi-tick active window yields **exactly one**
  predicted `hit` CombatEvent per target per swing.
