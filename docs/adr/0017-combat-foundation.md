---
status: accepted
---

# Combat foundation: commitment, hit-reaction, and poise

The MVP combat we shipped to stand the game up is a placeholder: attacks are
instant (a boolean intent resolved on the server tick, gated only by a cooldown),
Monsters deal **passive contact damage** by walking into you, there is no
knockback, the swing telegraph is rendered **client-local only** (other Players
never see it), and projectiles travel a straight line with no counterplay. It is a
grind, not a game. This ADR rebuilds the foundation so that real-time *skill* —
spacing, timing, reads — is the core of Combat, and so that everything we want to
build later (skills, Classes, bosses, aerial combos) has solid ground to stand on.

The decisions below interlock and only make sense as a set (cf. ADR 0001). The
single keystone: **an attack is no longer a point event — it occupies time and
commits the attacker.** Every other decision hangs off that.

## Decisions

1. **Phased attacks (the commitment model).** Every attack — Player *and* Monster
   — runs a three-phase state machine: **wind-up** (committed, interruptible,
   telegraphed) → **active** (hitbox live) → **recovery** (vulnerable, no act
   except via combo cancels). "Wind-up attack" is not a separate system; it is the
   long-wind-up end of a spectrum dialed by phase durations (a jab ≈ zero wind-up;
   a heavy ≈ a long readable wind-up). Identical machine for Monsters, because a
   Monster's wind-up is precisely what gives a Player something to react to.

2. **Hit-reaction is the universal currency.** Every hit carries, authored
   per-attack: `damage`, **hitstun** (how long the victim is locked out of action),
   and a **knockback** impulse (vector + magnitude). A connect puts the victim into
   a reaction state. **Automatic post-hit i-frames are removed** — they were a pure
   rate-limiter and are actively hostile to combos (you cannot juggle a target that
   blinks invincible on touch). Re-hitting a stunned target is the *point*.
   Rate-limiting is now governed by hitstun + the attacker's own recovery; **i-frames
   become an earned resource** (a Dodge, a Parry), never an automatic grant.

3. **Poise regulates whether a hit staggers at all.** Stagger (hitstun + knockback)
   does not fire on damage; it fires on **poise break**. Every entity has an
   accumulating **poise** pool that regenerates when not pressured; every attack
   carries **poise damage**; a hit always deals HP damage but only staggers when it
   breaks the pool. This delivers the required feel directly: a Slime's poise damage
   is trivial against a Player's regenerating pool, so weak Monsters *never* stagger
   you; strong Monsters (big poise hits, or sustained pressure) *occasionally* break
   you, and only then can you be launched and comboed. **Super-armor** falls out of
   the same stat — a wind-up grants a temporary poise spike, so a jab chips a boss's
   poise without interrupting its heavy swing. Symmetric: a Player breaking a
   Monster's poise to open a juggle is the same system. Poise/stagger is **not
   surfaced in the UI** at the foundation (deferred, likely revisited for bosses),
   and Player stagger is meant to feel **emergent and unsignposted**.

4. **One momentum body for every entity.** Players and Monsters share a single
   physics body (`position + velocity + mass`). Velocity each tick = input
   acceleration + external impulses + gravity − drag, then the existing
   axis-separated terrain collision (reused unchanged). **Knockback is just an
   impulse** that plays out physically — ground drag decays a shove, gravity arcs a
   launch. **Monsters are fully airborne-capable** on the same body (a grounded
   walker and a launched-into-the-air body are one code path) — this is the
   substrate that makes aerial juggles possible at all. **Mass** scales how far an
   impulse throws you (a launcher rockets a Slime, barely lifts an ogre). Hitstun
   **locks control but not physics**, so during stagger your body is at the mercy of
   the impulse + gravity — that is what being comboed *is*. Knockback feel is
   **snappy / arcade** (fast decay, short pops): readable at cell granularity and
   easier to balance than floaty hang-time.

5. **Defense: a Dodge and a unified directional Guard.** The **Dodge** is a short
   horizontal left/right hop granting brief i-frames, with recovery (committal).
   The **Guard** is one input with a skill gradient: the **opening ~120–160ms of any
   guard-raise is the Parry window** (Sekiro-style) — a hostile active frame landing
   in it is **parried**; holding past it is a **block** that takes chip damage and
   drains poise, and turtling to a poise break = **guard-break** stagger. A Parry's
   meaning is universal: **negate the hit, dump big poise damage onto the attacker**
   (usually breaking their poise → your punish/combo opening), and **reflect
   projectiles**. Guard is **frontal-arc directional** — hits from behind ignore it
   (rewards positioning without precise 8-way block inputs; consistent with "melee
   is forgiving"). Tying chip to poise means turtling is punished by the system we
   already built — no separate guard meter.

6. **Combo substrate.** Attacks chain via **cancel-on-connect**: an attack's
   recovery can be canceled into the next attack *once it has hit* (whiffs stay fully
   committal — flailing at air is punishable; landed hits flow). The vertical move is
   `attack` + a vertical input: **`up` + attack = launcher** (uppercut, sends the
   target up and pops the attacker to follow); **`down` + attack while airborne =
   spike** (drives the target down); a plain air attack keeps the target aloft for
   the juggle. **Combo decay** bounds juggles (the juggle-loop analog of poise):
   each successive hit in one stagger adds less hitstun and the target falls faster,
   so juggles self-terminate and force a return to neutral — without it, the first
   poise break is a death sentence.

7. **Progression-gated moveset (two categories).** Combat abilities split into
   **moveset abilities** — passive, no-cooldown extensions of what the attack button
   does (string extensions, launcher, aerials, spike, cancels, **Parry**), gated by
   level (and later Class) — and **active skills**, the existing slotted,
   cooldown-bound specials (Power Strike, Ground Pound), unchanged. A level-1 Player
   has only **basic attack + hold-block + Dodge**: enough to trade with a Slime, no
   combos. The "dope combos" are *earned* as moveset abilities unlock. **Parry is an
   earned unlock** (beginners get the safe hold-block; the high-reward timing
   mechanic is graduated into).

8. **Projectiles are first-class hits.** A projectile carries the full
   `damage + hitstun + knockback + poise` payload like any melee hit (a pebble is
   trivial; a cannon shot can stagger). It is **telegraphed at the source** (the
   shooter's phased wind-up) and travels at a **reactable** speed (not hitscan). It
   is countered by the *same* defensive kit — Dodge through it (i-frames), block it
   (chip), **Parry to reflect it back** (now owned by you, can hit the shooter), or
   **destroy it with a melee active frame** (swat, no reflect). Straight-aimed is the
   foundational trajectory ("ranged is precise"); arc/gravity is a per-projectile
   property reserved for future variety.

9. **Monsters attack deliberately — passive contact damage is removed.** Touching a
   Monster does nothing (consistent with pass-through bodies). A Monster deals damage
   **only through telegraphed phased attacks**, so every point of incoming damage was
   dodgeable/blockable/parryable, and its punishable recovery *is* the Player's combo
   opening. AI stays dumb but intentional (approach/space → commit → recover).
   Foundational roster: a **melee committer** (reworked chaser — telegraphed
   lunge/swipe) and a **ranged poker** (reworked shooter — telegraphed aimed shot),
   with a **poise-tank** (must be poise-chipped before it can be launched) as the
   first showcase of the juggle loop.

10. **Replication: continuous action-state + discrete Effects.** Every entity gains
    a compact, authoritative **action-state** field in the 20 Hz snapshot — current
    move id + phase + phase progress + facing + flags (guarding, staggered, airborne)
    — bytes per entity per tick. This is what makes offense, defense, and reactions
    **visible to everyone** (fixing the local-only telegraph), and it *replaces* the
    old client-local telegraph (the telegraph is now just rendering the same
    authoritative state we render for others). The discrete **Effect** model (ADR
    0013) stays for *momentary* punctuation, with `Effect.kind` extended
    (blood/gore → + impact/parry/guard-break/launch). The originator predicts its own
    action for zero-lag feel and reconciles to the server; observers render straight
    from the field. (Qualifies ADR 0006 and ADR 0013.)

11. **Netcode for timing: authoritative + predicted + lag-compensated.** The server
    stays authoritative over all hit resolution (ADR 0001) — a Parry is a
    hit-resolution event. The client **predicts its own actions** (swing, guard,
    Parry flash, Dodge i-frames) instantly. To make server resolution agree with what
    the Player saw, input carries a client timestamp and the server applies **light
    lag compensation** (judges a Parry against where the attack *was on the Player's
    screen*, within tolerance). Windows are authored in **ticks, deliberately chunky**
    (~6–8 ticks) to absorb 30 Hz input quantization, jitter, and the non-Kitty input
    fallback. On the rare mispredict, snap to server truth. Rollback netcode is
    rejected (too heavy for a persistent many-entity World — cf. ADR 0001).

12. **Input: contextual verticality + an abstract action set with two schemes.**
    Melee has **no free aim** — verticality is contextual (ground string is
    horizontal; `up`+attack launches; airborne `down`+attack spikes). A new **`down`**
    action is added (crouch / drop-through / spike modifier); **jump moves to `space`
    only** (`up` retired as a jump alt, freeing it as the launcher modifier). Parry
    needs no tap-vs-hold measurement (it is the opening window of a guard-raise);
    **Dodge is a dedicated key** that hops in the held direction (double-tap rejected —
    needs a press-history layer and 30 Hz sends drop rapid taps). Bindings map onto an
    **abstract action set**, supporting two control schemes over identical intents: a
    **keyboard-only** scheme (`j` attack / `k` guard / `l` dodge, skills on `u`/`i`)
    and a **keyboard + mouse** scheme (left-click attack / right-click guard, skills on
    `e`/`r`). **Mouse position is reserved as the free-aim input for ranged Classes.**

13. **Game feel is a foundation, not polish.** Four data-driven client layers, all
    realizations of authoritative state (consistent with ADRs 0003/0005/0013):
    (a) a new **per-phase sprite-pose** animation system driven by the replicated
    `(move, phase)` (no extra wire cost); (b) **slash-arc** rendering that sweeps
    vivid glyphs across the active hitbox in the swing direction; (c) **hitstop +
    camera-kick** — a meaty hit briefly freezes the involved sprites' *render*
    (the sim keeps ticking authoritatively) and kicks the camera a **1–2 cell,
    <150ms, decaying** viewport offset on big moments only (heavy hits, poise-breaks,
    launches, spikes; light hits get at most a brightness flash — micro-shake reads as
    jank at cell granularity); (d) extended **ParticleType**s (impact spark, Parry
    clash, poise-break flash).

14. **Weapons feed the combat model.** An equipped **Item** in the Weapon slot
    contributes three things, each into an existing system: a replicated **sprite id**
    (joins Avatar appearance, so others see *your* weapon swing), a **per-phase
    composited sprite + trail** (posed/swept by the same pose system; may define its
    own trail ParticleType), and a **stat block** that drives combat params
    (damage / arc size / poise damage / knockback / phase-speed) — this is what makes
    a greatsword feel heavy vs a dagger fast, using only the levers above. Weapons
    granting **distinct movesets** is deferred; foundationally all weapons share the
    one Warrior moveset and differ by stats, looks, and trail.

## Considered and rejected

- **Keep instant cooldown-gated hits, bolt features on top.** Rejected: every timing
  mechanic (Parry, deflect, punish, combo) requires that an attack *occupies time and
  can be interrupted*. You cannot parry an attack with no wind-up duration.
- **Keep automatic post-hit i-frames as the rate-limiter.** Rejected: invulnerability
  on first touch makes combos impossible; hitstun + poise + recovery do the
  rate-limiting and i-frames become an earned defensive resource instead.
- **Flat per-hit stagger threshold (non-accumulating poise).** Rejected: cannot
  express "sustained pressure eventually breaks you." The accumulating pool gives the
  chip-then-break rhythm and yields super-armor for free.
- **Floaty knockback / long hang-time juggles.** Rejected: harder to read on a coarse
  cell grid and harder to balance; snappy/arcade chosen.
- **Client-authoritative defensive resolution** (client decides its own
  Parries/blocks; PvE, bots a non-concern). Tempting and simpler, but rejected to keep
  ADR 0001's "server owns hit resolution" intact; server-authoritative + lag
  compensation gets the same feel honestly.
- **Rollback netcode.** Rejected: too heavy for a persistent World with many entities
  (already rejected in ADR 0001).
- **Full 8-directional free melee aim.** Rejected: keyboard-heavy and fights "melee is
  forgiving." Verticality is contextual; precise free-aim is reserved for ranged
  Classes via the mouse.
- **Double-tap Dodge.** Rejected: needs a press-history layer and 30 Hz input sends
  drop rapid taps, so it would feel unreliable; a dedicated key is deterministic.
- **Tap-vs-hold press-duration measurement for Parry.** Rejected as fiddly at 30 Hz;
  the Parry window is defined relative to press-time as the opening of any
  guard-raise, which the input layer already knows.
- **Weapons with distinct movesets at the foundation.** Deferred for scope; weapons
  vary by stats / looks / trail over the shared moveset, with the architecture left
  open to per-weapon move params later.
- **Retain passive contact damage.** Rejected: it is the core reason the MVP "sucks" —
  unreactable, unpunishable chip. All Monster damage is now telegraphed.

## Consequences

- **Major shared-sim rework in `@mmo/shared`.** `stepZone()` gains the attack phase
  state machine, poise/hitstun/knockback bookkeeping, the unified momentum body
  (mass + impulses + airborne Monsters), cancel/combo-decay rules, and telegraphed
  Monster attack AI replacing contact damage. All of it stays **pure and
  deterministic** (ADR 0006) — the client and future server cannot diverge.
- **Protocol changes (qualifies ADR 0006 + 0013).** The snapshot gains a per-entity
  **action-state** field; `Effect.kind` is extended; input gains a client timestamp
  for lag compensation. Server hit resolution gains a lag-comp rewind (within
  tolerance) against the observer's interpolated view; windows are authored in ticks.
- **Input layer rework.** A new `down` action; jump moves to `space`; Guard (with the
  opening Parry window) and a dedicated Dodge are added; active skills move off
  `k`/`l`. Bindings resolve through an abstract action set with keyboard-only and
  keyboard+mouse schemes; mouse-position aim is stubbed for future ranged Classes.
  (Verified in the Forge Zone editor: OpenTUI mouse-button events fire alongside
  held movement keys, so the keyboard+mouse scheme is feasible.)
- **New client subsystems (realizations only).** A data-driven per-phase
  **sprite-pose** animation system; **slash-arc** rendering; **hitstop** (render-only
  freeze; the sim never pauses); **camera-kick** (a small decaying viewport offset);
  and extended **ParticleType** profiles. All client-side, all driven by authoritative
  state — nothing here touches the shared sim.
- **Skills/progression extension.** A passive **moveset-ability** category is added
  alongside the existing cooldown **active skills**, gated by `skillUnlocked(level)`
  (and later Class). The Warrior's level curve now unlocks string extensions →
  launcher → aerials → spike → cancels → Parry.
- **Weapons wire into appearance + combat.** The Weapon Item contributes a replicated
  sprite id, a composited per-phase sprite/trail, and a stat block feeding combat
  params; weapon-specific movesets remain a future layer.
- **Monster content migration.** The existing chaser/shooter are reworked into the
  telegraphed melee-committer / ranged-poker archetypes; Power Strike and Ground
  Pound remain active skills.
