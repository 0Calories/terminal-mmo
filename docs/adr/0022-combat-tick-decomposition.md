---
status: accepted
---

# Project-then-resolve: the combat tick decomposes into pure passes

`stepZone` is the authoritative tick (ADR 0001/0006), and it has grown into a
~250-line god-function. Within one pass it interleaves *advancing* each entity,
*resolving* every cross-entity hit (in **both** directions), and *death/loot* — and
it does so inside a single monster loop where:

1. **Reaction logic is smeared across the loop in both directions.** A monster's
   strike against Avatars (`zone.ts` ~379–465: guard/parry/poise/break) and an
   Avatar's swing against *that* monster (~481: `swingHits` dedup, poise, death) are
   resolved per-monster, interleaved with that monster's AI and movement.
2. **Resolution order is an accident of the monster array.** The i-frame gate
   (`avatarHittable`) means only one of several simultaneous monster strikes lands on
   an Avatar per tick — and *which* one is just "lowest array index," not a designed
   rule. Parry→poise→swing timing is likewise emergent from loop nesting.
3. **Reaction has two homes.** Melee resolves in the monster loop; **Projectiles**
   resolve in a *separate* block (`zone.ts` ~607–713) with their own copy of the
   hit-reaction payload.
4. **The client runs a second, untested copy of the Avatar fold** (`index.ts` ~479)
   plus `predictHits` — the divergence risk the shared-logic architecture exists to
   prevent, and the friction that opened this review.

This ADR records the *target structure* that untangles all four. It **extends**, and
does not relitigate, ADR 0017 (combat foundation), ADR 0019 (CombatEvent → Effect),
and ADR 0001 (client-authoritative position, server-authoritative outcomes).

## The shape

The tick splits into **project** passes (per-entity, advance state + emit a
projected attack) and **one resolve** pass (cross-entity reaction), then deaths:

```
stepZone(state, intents, dt):
  avatars     = stepAvatars(state, intents, dt)        // project: fold + Strike(s)
  monsters    = stepMonsters(state, avatars, dt)        // project: AI/move + Strike(s)
  projectiles = stepProjectiles(state, dt)              // project: travel + Strike each
  resolved    = resolveCombat(avatars, monsters, projectiles, strikes, dt)
  deaths      = resolveDeaths(resolved, …)              // respawns + last-hitter XP/loot
```

A **Strike** is the projected-attack value handed from a project pass to
`resolveCombat` — *"this hitbox deals this damage/poise, facing →, on behalf of this
faction, with this reaction profile."* It is a *projection*, never applied at the
project site:

```ts
type ReactionProfile = { kind: 'melee' } | { kind: 'projectile' };

type Strike = {
  attackerId: number;
  attackerKind: 'avatar' | 'monster' | 'projectile';
  hitbox: Box;            // a swing's active box, OR a projectile's body this tick
  damage: number;
  poiseDamage: number;
  facing: Facing;
  faction: Faction;       // 'players' | 'monsters' — selects valid victims
  reaction: ReactionProfile;
};
```

`resolveCombat` resolves every `Strike` by **one uniform rule**: against overlapping,
**hittable**, **opposing-`faction`**, **not-already-hit** victims.

## Decisions

- **The tick is project-then-resolve.** Per-entity passes (`stepAvatars`,
  `stepMonsters`, `stepProjectiles`) only *advance state and project Strikes*. A
  single `resolveCombat` pass owns **every** cross-entity reaction, both directions.
  This gives the reaction exactly **one home** (vs. today's monster-loop + projectile
  block) and makes each project pass independently testable. The rejected alternative
  — per-entity passes that each resolve their own outgoing hits — keeps reaction in
  two places and forces an ordering coupling (whichever pass runs second sees the
  other's post-hit state).

- **`Strike` is the project→resolve handoff value**, replacing the positional
  `hitboxes[]` / `damages[]` parallel arrays. It carries attacker identity, facing,
  poise, faction, and reaction, so `resolveCombat` no longer re-derives them and is
  symmetric over attacker kind — a Strike from an Avatar swing, a monster strike, and
  a projectile contact resolve through the same loop.

- **The per-swing dedup ledger is *not* a field on `Strike`.** `swingHits` exists
  because a melee hitbox is live for *multiple* ticks and must hit each target once
  per swing (ADR 0017 §2) — it is a property of a **persistent multi-contact attack
  instance**, not of melee. It lives on the **source entity** (a swinger's
  `swingHits`; a piercing shot's hit-set), and `resolveCombat` reads/writes it as a
  keyed side-table (`attackerId → hit victims`). A single-contact projectile has none
  (it despawns on contact). This is why a Projectile `Strike` carries no melee-only
  state — the asymmetry the grill surfaced dissolves.

- **`faction` is the uniform victim-selection key, promoted from a Projectile-only
  field to every Strike.** A Strike resolves only against opposing-faction victims.
  Two invariants then hold **by construction**, not by scattered conditionals:
  - **PvE** — two Avatars share a faction, so no Avatar Strike ever selects an Avatar
    victim (PvP stays parked, CONTEXT.md).
  - **Reflect-safety** — a **Reflect** re-factions a shot `monsters → players`, after
    which victim selection yields monsters only; the reflected shot is *never tested*
    against Avatars, so it can neither harm nor collide with another Player. (Collision
    *is* the faction-gated overlap test — Projectiles have no separate solid body.)

- **`resolveCombat`'s resolution order is explicit and deterministic**, preserving
  today's *behavior* while making the three currently-incidental orderings into named
  rules in one place:
  - **nearest-attacker-wins** on same-tick contention for a victim (ties by id) —
    replacing "lowest monster array index";
  - **in-pass i-frame consumption** — a gated hit consumes the victim's hittability
    for the rest of this tick's resolution (one hit per i-frame window, as today);
  - **parry before swing** — guard/parry (incoming) resolves before outgoing swings,
    so swing poise math sees post-parry state.

- **Counterplay lives in a closed `ReactionProfile` union**, switched on *only* at the
  guard-interaction step: melee parries to a **Stagger** + attacker poise dump;
  a Projectile **Reflects** / **swats**. Damage, poise, break, and death application
  are tag-agnostic and run identically for both — the resolution loop is not forked.
  A data-driven descriptor was rejected as YAGNI for two kinds (a future third kind is
  a new tag).

- **`resolveCombat` owns all contact resolution and returns the updated entity sets**
  — avatars, monsters, **projectiles** (consumed / reflected), effects, and the death
  set. `stepProjectiles` is reduced to *travel + Strike emission*; a reflected shot's
  reversed velocity is set at resolution and *travels* next tick via `stepProjectiles`.

- **`resolveCombat` splits by victim faction, because Guard is Avatar-only.**
  Internally it is two ordered sub-passes:
  - **`resolveHitsOnAvatars`** — monster melee + monster projectiles. The **Guard**
    hub (parry / block / reflect / swat), which *must* stay one slice: a single guard
    raise can face both a melee strike and a shot in one tick, so its consumption
    cannot be split across a seam.
  - **`resolveHitsOnMonsters`** — Avatar swings + reflected player projectiles.
    Guardless: hittable + poise / break / death only.

  They run **avatars-pass → monsters-pass** so the `parry-before-swing` ordering holds
  (a parry staggers a monster; an Avatar swing then sees its post-parry poise). A
  reflected shot is *produced* in the avatars-pass and *consumed* only on a later tick,
  so there is no intra-tick reflect coupling between the two.

- **`stepAvatarCombat(avatar, intent, ctx) → { avatar, strikes }` is the per-avatar
  shared unit** — the first slice (the original "candidate 1"). Its `ctx` is
  avatar-scoped (`level, class, weapon, dt`): no monsters, no faction branch. The
  server's `stepAvatars` **maps** it over the avatar set; the **client calls it
  directly for its own avatar** in prediction. A shared **`Strike`-overlap detector**
  (today's `predictHits`, generalized) serves both: the client projects its own
  Strikes to **blood-only** Effects off interpolated monsters; `resolveCombat` runs
  the *same* detector for the **full authoritative reaction**. Detection is shared;
  reaction asymmetry stays at the callers (ADR 0019). The untested client fold and the
  verbatim `swingHits = swingStarted ? [] : prev` duplication retire.

- **Monster AI is a pure intent producer; the swing machine is shared, not the fold.**
  `stepMonsters` factors into `decideMonsterIntent(monster, avatars, dt) →
  MonsterIntent` (target selection, chase/patrol/engage, the *commit* decision) — pure
  and headlessly testable with no physics in scope — feeding the same advance-and-
  project machinery an Avatar uses (movement is already shared via `stepEntity`; the
  wind-up→active→recovery swing is already the same `meleeActive` / `meleeHitbox`
  machine). What is shared is the **Attack-phase machine**, *not* a single fold over
  both entity kinds: the Avatar-only kit (dodge / guard / skill / cooldowns) layers on
  for Avatars and is absent for monsters, so we do not recreate a wide `kind`-branching
  god-fold. **Slice 1 stays strictly Avatar-shaped** — monster AI and movesets will be
  unique, so the shared swing primitive crystallizes when `stepMonsters` lands and real
  moveset needs are visible, not speculatively. Unique movesets are expected to ride as
  **data parameterizing the shared phase machine** (as the Weapon stat block does, ADR
  0017 §14), a forward concern out of this ADR's scope.

- **`resolveDeaths` owns death *consequences*, not the death decision.**
  `resolveCombat` decides death (applying damage is what makes a contact a death, ADR
  0019), emits the death `CombatEvent → Effect` at the resolution site, and
  **accumulates `contributors`** as each Strike connects. `resolveDeaths` consumes the
  resulting death set for *world-state consequences*, preserving the existing
  monster-local / avatar-escalates asymmetry:
  - **Monsters** — XP / instanced-loot grants to the accumulated contributors (#37),
    respawn scheduling, removal — all zone-local.
  - **Avatars** — emit the transient *died-this-tick* set only; cross-zone respawn
    into town stays a layer up in `stepServerWorld`, so `resolveDeaths` never reaches
    across zones (the zone/world boundary stays intact).

  Contributor *accumulation* (resolveCombat) is split from contributor *payout*
  (resolveDeaths), mirroring the `swingHits` reset/add split. The **instanced-loot
  per-contributor split** that `stepZone`'s docstring flags as a separate issue gets a
  clean home here but is *not* designed by this ADR.

## Considered and rejected

- **Rebuild as a stateful zone/actor hierarchy that owns its own transport** (`server
  → zones → {combat, players}`, each "listens and broadcasts"). Embedding I/O in the
  sim modules breaks the property the whole codebase rests on: the step is a pure
  function of `(state, intents, dt)`. It would kill offline parity (`runOffline` runs
  the same step), deterministic replay, and lag-comp (ADR 0017 §11 widens the parry
  window by *intent* staleness — only meaningful against a pure timeline). **I/O stays
  at the host edge**; the sim computes *who* + *what* (e.g. `sessionsInChannel`
  returns target ids), the host performs the *send*. The clean layering already exists
  in `serverWorld.ts`; this is decomposition within it, not a rebuild.

- **A "wide" `stepAvatarCombat → { entity, events }`** that pulls hit *application*
  into the per-avatar unit. The Avatar→Monster reaction is asymmetric (server mutates
  monsters authoritatively; the client predicts chip blood only) and already
  singly-homed in `stepZone` (run by both the real server and the offline client). A
  wide unit would need a fat ctx (monster set + authority flag) and branch internally
  — a shallow, wide-interface module — while creating a *second* home for reaction.

- **Snapshot-simultaneous `resolveCombat`** (gather all hits against post-move state,
  apply together). Trivially order-independent, but silently changes behavior: with no
  i-frame set at snapshot time, *multiple* monster strikes land on one Avatar per tick
  (burst damage bypassing the i-frame mechanic), and parry/poise timing shifts. We
  want identical feel, so order is explicit instead.

- **Melee-only `Strike` first, fold Projectiles in later.** Smaller first step, but it
  re-creates the two-homes-for-reaction problem we are eliminating. Projectiles unify
  into the same resolution from the start; their unique counterplay stays in the
  `ReactionProfile` + a pre-resolution travel step.

## Consequences

- **Staged, not a big bang — and slice 1 is behaviour-preserving.** `Strike` is a
  handoff type to `resolveCombat`; introducing it before that consumer exists would
  mean a throwaway `Strike → parallel-array` adapter plus unread `faction` /
  `ReactionProfile` fields. So the slices are:
  1. **Fold extraction** — `stepAvatarCombat(avatar, intent, ctx) → { avatar, hitbox,
     damage, swingStarted }`, *same types as today*. The server's `stepAvatars` maps
     it; the client calls it directly. This alone delivers the review's prize (one
     tested fold, no client divergence) and ships green with **no new vocabulary**.
     `stepAvatarCombat`'s return upgrades to `{ avatar, strikes }` in slice 2 — a
     mechanical change, cheaper than building and deleting an adapter.
  2. **`resolveHitsOnMonsters` + introduce `Strike` / `faction` / `ReactionProfile`** —
     the guardless path is the smallest one that proves the vocabulary (mirrors ADR
     0019's "define vocab, migrate one path").
  3. **`resolveHitsOnAvatars`** — the Guard hub, in one slice.
  4. **Projectile unification** into both sub-passes (`stepProjectiles` projects Strikes).
  5. **`resolveDeaths`** — separable; may land any time after slice 1.

  This ADR promotes to `accepted` when slice 1 merges.
- **`CONTEXT.md` gains `Strike`, `Faction`, and `ReactionProfile`** as ubiquitous
  language; `Reflect` / `Projectile` / `Combat` entries cross-reference them.
- **A regression test pins reflect-safety**: Player A parries a shot with Player B
  standing in the reflected path → B is untouched (and uncollided). This is the test
  that stops a future refactor from quietly reintroducing Avatar-victim selection.
- **`resolveCombat` is pure and headlessly testable**, and its resolution order is now
  *asserted* (nearest-attacker, single i-frame consumption, parry-before-swing) rather
  than emergent from iteration.
- **No wire/protocol change.** Effects still ride the snapshot (ADR 0013 §2 / ADR
  0019); `Strike` and the side-table ledger are shared-internal, never serialized.
