---
status: accepted
---

# Combat: commitment, poise, project-then-resolve, events on the wire

Real-time skill — spacing, timing, reads — is the core of Combat. The
keystone: **an attack is not a point event; it occupies time and commits the
attacker.** Everything else hangs off that.

## Decisions

- **Phased attacks.** Every attack — Player and Monster — runs wind-up
  (committed, telegraphed) → active (hitbox live) → recovery (vulnerable).
  Instant cooldown-gated hits were rejected: you cannot time-counter an attack
  with no duration.
- **Hit-reaction is the universal currency**: every hit carries authored
  damage, hitstun, and a knockback impulse. Automatic post-hit i-frames are
  removed (they make re-hitting a stunned target impossible, which is the
  point); i-frames are earned (the Dodge).
- **Poise regulates stagger.** An accumulating pool, regenerating when
  unpressured; hits always deal HP damage but only stagger on a poise
  *break*. Weak Monsters never stagger you; sustained pressure eventually
  does; a wind-up's poise spike is super-armor. Symmetric for Monsters, and
  the same system punishes turtling (guard-break) — no separate guard meter.
- **One momentum body for every entity** (`position + velocity + mass`);
  knockback is an impulse played out physically; Monsters are fully
  airborne-capable on the same body; hitstun locks control, not physics.
  Feel is snappy/arcade — floaty hang-time is unreadable at cell granularity.
- **Defense is Dodge and Block.** Dodge: a committal hop with brief i-frames
  on a dedicated key. Block: any raised Guard, frontal-arc only, chip damage +
  poise drain — gated solely by an equipped **Shield** in the offhand slot
  (the one deliberate exception to "loot never changes playstyle"). Parry,
  Reflect, and the lag compensation that existed to judge parry timing were
  cut — parry is too finicky at terminal fidelity — as was the whole
  juggle/launcher/combo-cancel substrate.
- **Monsters attack deliberately; passive contact damage does not exist.**
  All Monster damage comes through telegraphed phased attacks, so every point
  of incoming damage was answerable and the recovery is the Player's opening.
  Projectiles are first-class hits: full payload, telegraphed at the source,
  reactable speed, countered by dodge/block/swat.
- **The tick is project-then-resolve.** Per-entity passes advance state and
  emit **Strikes** ("this hitbox, this damage/poise, this Faction"); one
  `resolveCombat` pass lands every Strike by a uniform rule — overlapping,
  hittable, opposing-Faction, not-already-hit — with explicit, deterministic
  ordering. Faction gating makes PvE hold by construction (Avatars share a
  faction, so no Avatar can ever damage one).
- **Monster Brains emit Drives, never effects.** A Brain perceives and
  decides; nothing outside a Brain initiates an attack, and a Brain never
  applies damage. Each Monster is a module composing a Movement engine and a
  Combat engine over one shared patrol/combat Skeleton; behaviour is promoted
  to shared code on second use, never speculatively.
- **Combat resolves into CombatEvents, which cross the wire.** The server
  broadcasts the semantic fact (`hit`/`break`/`death`/`swat`); each client
  projects it to presentation (particles, sound, damage numbers, hitstop,
  camera-kick) through one routing layer — the server holds zero presentation
  knowledge, and presentation is never emitted inline at damage sites (that
  duplication was a real bug class). The attacker predicts its own optimistic
  `hit` for zero-latency feel and is suppressed from the broadcast;
  `break`/`death`/incoming hurt are authority-only. `break` carries `source`
  so the attacker converts its predicted damage number instead of doubling it.
- **Replication is continuous action-state** (move id + phase + progress +
  flags per entity in the snapshot), so offense and defense are visible to
  everyone; timing windows are authored in deliberately chunky ticks (~6–8)
  to absorb 30 Hz input quantization.
