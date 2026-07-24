---
status: accepted
---

# Monster modules compose Movement and Combat engines; attack execution moves behind the Combat-engine seam (extends ADR 0034)

ADR 0034 gave each Monster archetype one Brain and made every Brain emit
Drives only. That seam held, but the layer behind it accreted: one file held
every brain, shared helpers, and the wiring record; tuning lived in a separate
archetypes file; and attack *execution* — the thing that makes each monster's
fight distinct — lived in four hard-coded branches of the zone tick (the
committed-drive override, commit interpretation, the landing-cuts-to-recovery
rule, and Strike/projectile construction). "How the Slime fights" was smeared
across a brain, a config file, and a 90-line loop.

The growth pressure showed within a week of the Slime shipping: both
QA-caught Slime bugs were decision-*ordering* bugs (commit check vs. rest
gate; patrol-rest breaks on detection while approach-rest does not), a class
the structure invites because perceive/decide ordering is implicit
if-ordering re-implemented per brain. Monsters are meant to feel unique in
movement and combat, so every future monster multiplies both problems.

## Decisions

- **A Monster is a module composing two engines over one shared Skeleton.**
  Each monster module holds its complete definition — a character sheet of
  stats plus a configured **Movement engine** (walk, hop) and **Combat
  engine** (swing, fire, pounce). Composition, not inheritance: monsters vary
  independently along the movement and combat axes, so there is no base-class
  tree; everything stays pure functions over plain, serializable data.
- **The Skeleton is the one Patrol/Combat state machine**, written once:
  gates (stunned/committed) → perceive → transition → delegate. In Patrol it
  asks the Movement engine to wander; in Combat the Combat engine leads —
  it picks the destination (close to range, hold range, stop at the pounce
  lip), calls the Movement engine to get there, and commits the attack. The
  state is *stored* in the monster's memory, but the initial transition rules
  reproduce the previous memoryless behaviour exactly (enter Combat within
  vision, exit the moment outside — leash equals vision). Only the Skeleton
  reads or writes the state; engines receive it, never set it. Sticky aggro
  is a deliberate future exit-condition change gated on manual QA.
- **Combat engines are two-sided; the zone tick becomes generic.** The
  decision half runs inside the Brain and emits Drives only — ADR 0034 is
  unchanged. The execution half is the set of hooks the zone tick calls after
  a commit: the committed-drive override, commit-time timer setup, post-step
  rules, and Strike/projectile construction. Each hook maps 1:1 to a branch
  the loop already had; the loop no longer knows what a pounce is, and a new
  attack pattern is a new engine module, not new tick branches. Physics and
  stepping stay in the zone; determinism is untouched.
- **One character sheet per monster; engine defaults with overrides.** Stats
  hold engine-independent numbers (hp, speed, mass, poise, damage, **vision**
  — formerly aggro — and **range**, which each Combat engine interprets:
  swing's strike threshold, pounce's commit distance, fire's keep-distance).
  Shape numbers (windup, leap scales, rest cadence, ballistics, cooldowns)
  are engine defaults, seeded from the founding monster's QA-approved values;
  once an engine has a second customer, tuning happens via that monster's
  overrides, never by editing defaults. The archetypes file dissolves into
  the monster definitions; the registry stays exhaustively keyed by monster
  type.
- **Shared-on-second-use.** A behaviour lives in its monster's module until a
  second monster needs it, then it is promoted to the shared module — a file
  move, cheap because every engine speaks the same interface from day one.
  Walk and swing start shared (chaser and brute); hop and pounce stay in the
  Slime's module. Nothing is promoted speculatively, and the Skeleton stays
  thin: fleeing, flying, and multi-phase arrive with their first customer.
- **Monster memory is typed.** The opaque `ai` field of ADR 0034 becomes a
  typed shape: the Skeleton's state plus one optional kind-tagged slice per
  engine, each engine narrowing only its own slice. The courier contract is
  unchanged — the tick feeds it back without inspecting it, and it never
  rides the wire. The combat-memory tag axis is the *engine*, not the monster
  type (chaser and brute share swing's).
- **Tests move to the new seams with their subjects.** Skeleton ordering
  tests (new) pin the transition/ordering rules for every monster at once;
  engine unit tests absorb the brain-seam and pounce zone-seam suites'
  assertions; thin per-monster behaviour specs prove the composition. A
  behaviour assertion may change harness but never disappears; each migration
  slice ports the tests whose seam it moves and stays green under `bun run
  ci`. The refactor is behaviour-preserving throughout — the QA-approved feel
  is the contract.
