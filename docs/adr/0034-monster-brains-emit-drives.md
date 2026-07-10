---
status: accepted
---

# Monster Brains emit Drives; all damage flows through Strikes (finishes ADR 0022)

Monster behavior was an inline pile of independent `if` conditions in
`stepZone`, fused with physics and combat resolution — and it contradicted the
documented architecture: ADR 0022 and the glossary say every attack (Avatar
swing, Melee committer, Projectile) emits a **Strike** into one resolve pass,
but monster melee actually resolved inline against avatars, hand-applying
guard/poise/knockback on the spot. Faction gating was structural (two code
paths), not the uniform rule. The condition pile also produced incoherent
behavior: the shooter's fire decision was gated only by aggro and cooldown, so
it fired point-blank while backpedaling — movement and attacking never knew
about each other.

## Decisions

- **The controller pattern: a Brain's entire output is a decision, never an
  effect.** `brain(entity, view) → { drive, ai }` — the Drive carrying move
  direction, jump, aim, and optionally an attack commit naming an ability
  (glossary: the commit rides the Drive). The zone tick is
  uniform per entity: obtain a **Drive** (from the net Intent for players, from
  the Brain for monsters), feed physics, let attack phases project Strikes, and
  land everything in the single resolve pass. Nothing outside a Brain ever
  initiates an attack; a Brain never applies damage or moves anything.
- **Monster melee reroutes through the Strike resolve pass.** This is a
  deliberate sim-behavior change (intra-tick resolution timing shifts from
  inline-during-AI-loop to after-all-projection; monster swings gain `swingHits`
  dedup semantics) and makes the ADR 0022 / glossary claim true instead of
  aspirational. Flagged for manual QA of brute/chaser swing feel.
- **Brains are small state machines over an ability table** (the MMO-standard
  tier — explicit states like patrol/chase/reposition/attack), not behavior
  trees or utility AI, which are overkill for four archetypes. The shooter only
  commits `fire` from inside its comfort band, fixing point-blank firing.
- **One opaque `ai` memory field per entity**, read and written only by its own
  Brain — invisible to the tick, combat, and the wire (never in snapshots).
  Stateless every-tick re-derivation was rejected: sequences ("reposition,
  *then* attack", leashing, Boss phases) need memory, and their absence is what
  made the shooter incoherent.
- **Archetype tuning becomes one data profile per archetype** in `entities/`,
  merging the scatter across `world.ts` (`spawnStats`), `combat.ts`
  (`meleeProfileOf`), and hardcoded `SHOOTER` constants. Adding a Monster
  archetype = one profile + one Brain; the tick and combat are untouched. The
  Boss — today only a persistence flag, with no behavior — is the intended
  first customer.
