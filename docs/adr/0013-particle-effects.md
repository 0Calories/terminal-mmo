---
status: accepted
---

# Particle effects: authoritative Effects, client-realized Particles

Combat needed visual punch — blood when a Monster is hit or dies, and when an
Avatar is hurt or dies. The design splits cleanly in two, and that split is the
decision worth recording (see the **Effect** and **Particle** glossary entries).
An **Effect** is a small, authoritative, deterministic descriptor of *what
happened* (`{ kind: 'blood', x, y, intensity, dir }`), produced in shared logic
the instant Combat resolves. A **Particle** is the client-side, non-deterministic
realization of *what it looks like* — a cloud of gravity-driven specks simulated
locally at render framerate. The shared layer owns the fact; the client owns the
pixels.

## Decisions

- **Effects are emitted in `stepZone()`, exactly at the damage-application sites.**
  A hit only lands when the target is out of i-frames (`hurtT <= 0`), and damage
  is applied once per target per tick, so those sites are the natural, complete
  emit points — no separate detection, and no Effects on blocked/i-framed hits.
  `intensity` scales with damage (chip hit → death). `dir` is `-1 | 0 | 1`: the
  horizontal bias of the blow, where **0 is a radial burst** (used by the death
  Effects). `stepZone`'s return gains a per-tick `effects: Effect[]` alongside the
  existing `deaths[]`.

- **Effects ride inside the snapshot, server→client only.** They batch into the
  per-recipient snapshot that is already built every tick with Zone-interest
  filtering, so a blood Effect arrives in lockstep with the HP change that caused
  it. The client *never* reports Effects upward — the server, authoritative over
  all of Combat, derives every Effect itself. This keeps the cheating/spam surface
  closed and the effects channel one-directional. (Qualifies ADR 0006: the
  snapshot gains an `effects` list; client and server ship together, no skew.)

- **The local Player predicts only their own *outgoing* hits.** When you swing and
  believe you connected, the client spawns the blood immediately for zero-latency
  feedback, and the server's authoritative broadcast of that same Effect is
  **suppressed back to its cause** (you already drew it) — that is the de-dup
  mechanism. *Incoming* hurt is **not** predicted: it renders from the snapshot,
  firing together with the existing hurt-flash rather than desyncing from it. No
  rollback on mispredict — a stray decorative splat on a missed swing is invisible
  and not worth reconciling.

- **The Particle simulation is non-deterministic and client-local.** Bursts are
  *semantically* the same across clients (right place, right direction, right
  intensity) but not pixel-identical — each client expands one Effect into specks
  with its own RNG, at its own framerate. Particles run in the imperative playfield
  render loop (per ADR 0005), not the shared 20 Hz sim: they reuse client-side
  terrain (`isSolid`) to land, bounce once, rest ~2.5s, then fade. Drawn two-pass
  (resting blood behind sprites, airborne in front), always below speech
  bubbles/emotes.

- **Per-Particle behavior is a data-driven `ParticleType` profile, not hardcoded
  blood.** One generic simulator reads a declarative profile per type — gravity,
  bounce, terrain collision, rest/fade durations, maxLife, per-stage glyph sets,
  color-over-life curve, z-layer, launch speed/spread — so a new look (`dust`,
  `sparkle`, `spark`, `smoke`) is a new data entry, not new code. The blood
  lifecycle above is simply the `blood` profile. A client-side map turns each
  `Effect.kind` (the semantic game event) into one or more `ParticleType`s; it is
  1:1 today, but the indirection lets a future event spawn several looks at once
  (e.g. a death spawning `blood` + `gib`) with no wire change. Genuinely exotic
  behavior that data can't express (splitting, homing, per-type fields) is deferred
  to optional behavior hooks layered on the profile later — not built now.

## Considered and rejected

- **Client-infer Effects from snapshot deltas (no wire change).** Misses hits that
  don't change HP, can't recover blow direction, and double-counts under
  interpolation. The explicit Effect carries direction/intensity and is the only
  thing that makes offline and networked behave identically.
- **Pixel-identical bursts (seeded, lockstep particle sim).** Buys a property no
  player can observe — there is nothing to compare a burst against — while forcing
  seeds on the wire and a fixed-timestep sim that fights smooth high-FPS rendering.
- **Client reports its predicted Effects to the server.** Redundant (the server
  resolves the same hit authoritatively) and opens a spoofing surface — a client
  could inject blood anywhere.
- **Predict the local Player's *incoming* hurt.** Would desync from the
  server-sourced hurt-flash and require re-deriving contact/projectile collision
  against interpolated-past enemies, all to shave ½ RTT off a decorative splat.

## Consequences

- `protocol.ts` gains the `Effect` type and an `effects: Effect[]` field on the
  `snapshot` message (encode + decode + round-trip test). Originator-suppression
  happens while building each recipient's snapshot.
- `stepZone()` returns `effects[]`; the offline loop (`sim.ts`) reads that list
  straight off the step result and feeds the client particle system directly — no
  wire, same Effects, identical behavior to networked play.
- The client gains a particle module: a fixed ~2000-Particle pool (no per-frame
  allocation), per-Effect count `clamp(base + intensity·scale, 1, ~24)`, **off-
  camera Effects skipped entirely**, and **evict-oldest** when the pool is full. It
  also holds the `ParticleType` profile registry (MVP: just `blood`) and the
  `Effect.kind → ParticleType[]` spawn map.
- Effect emission is pure and unit-testable headlessly; the particle sim is tested
  for invariants (pool cap, lifecycle transitions, cull), not exact pixels.

## Amendment (2026-07): named effects, decoupled feel systems, one-way collision

The wire half of this ADR was superseded by ADR 0029 (CombatEvents on the wire,
client-side `effectsOf` projection). The client half is restructured with the
deep-modules pass (ADR 0032):

- **Named effects are the engine's only public surface** — `spawn('blood' | 'gore'
  | 'impact' | 'levelup', at, dir, intensity)`. Raw `ParticleType` spawning is no
  longer exported; each effect is one definition file owning all of its knobs
  (gravity, restitution, glyph ramp, fade curve, count-from-intensity). Adding a
  look is adding a file.
- **The `VisualEffects` facade dissolves.** Camera kick moves to the camera
  module (it is a viewport offset), hitstop to the game loop (it is render
  pacing, not a visual), the dodge echo to its own module (a sprite-ghost trail,
  not particles). `project`/`realize` collapse into one stateless routing layer —
  the only place that knows a `break` means impact + kick + hitstop together.
- **Particle terrain collision rebuilds on core physics' shared `sweep`
  primitive** (bidirectional — the old downward-only `surfaceHit` let rising
  specks embed inside ≥2-thick solids) and **obeys the entity one-way rule**
  (ADR 0026): descending specks land on a platform's top, ascending specks pass
  through; only walls/ground block. Two diagnosed stuck-in-wall bugs are fixed in
  the rebuild: the draw column is floor-aligned for colliding specks (round()
  painted wall-adjacent specks into the wall tile), and a colliding speck whose
  own cell is solid dies instead of resting.
