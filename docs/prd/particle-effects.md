# PRD: Pixel Particle Effect System

> Design: see [ADR 0013](../adr/0013-particle-effects.md) and the **Effect** /
> **Particle** / **ParticleType** entries in [`CONTEXT.md`](../../CONTEXT.md).
> Tracked for implementation as a `ready-for-agent` GitHub issue.

## Problem Statement

Combat is a first-class pillar, but it lands without visceral feedback. A Player
swings and connects, or takes a hit, and nothing erupts — the Monster's HP just
ticks down. The art style reads as flat and static, and hits feel weightless.
The game needs visual punch at the moments that matter most: striking a Monster,
killing it, and getting hurt.

## Solution

A **particle effect system**. On a combat event, the game spawns a burst of pixel
**Particles** — starting with blood — that fly outward with physics, fall under
gravity, bounce once, rest where they land for a couple of seconds, then fade.
Bursts appear for every Player in range to see them, synchronized through the
existing per-tick snapshot. For the acting Player, their own outgoing hits spawn
blood **immediately** (client-predicted) so combat feels instant, while everyone
else sees the authoritative burst the server derives.

The system is built generic from day one: a Particle's entire look and lifecycle
come from its **ParticleType** — a declarative data profile — so future effects
(dust, sparkle, spark, smoke) are new data entries, not new code. Blood is simply
the first registered ParticleType.

## User Stories

1. As a Player, I want blood to erupt from a Monster when my attack connects, so that my hits feel impactful and I get clear confirmation I landed them.
2. As a Player, I want the blood from my own hits to appear instantly without waiting for the server, so that combat feels responsive and lag-free.
3. As a Player, I want a bigger, radial blood burst when a Monster dies, so that kills feel climactic and rewarding.
4. As a Player, I want blood to spray from my Avatar when I take damage, so that getting hurt feels consequential and is easy to notice.
5. As a Player, I want my own hurt blood to appear together with the existing hurt-flash, so that the two feedback cues reinforce each other instead of desyncing.
6. As a Player, I want a small blood burst when my Avatar dies, so that death reads as a distinct, dramatic moment before I respawn.
7. As a Player, I want bigger hits to throw more blood than chip hits, so that the visual intensity reflects how hard the blow landed.
8. As a Player, I want blood to fly in the direction the blow was going, so that the effect feels physical rather than arbitrary.
9. As a Player, I want blood to fall, bounce, and settle on the ground under gravity, so that the world feels physical and the splatter looks natural.
10. As a Player, I want spent blood to rest on the ground briefly and then fade away, so that the screen stays readable and doesn't accumulate clutter.
11. As a Player in a Zone with other Players, I want to see the blood from their hits and the Monsters they fight, so that the shared World feels alive and populated.
12. As a Player, I want effects from far-off, off-screen events to not appear on my screen, so that I only see what's relevant to where I'm looking.
13. As a Player on a busy Field with lots of combat, I want the game to stay smooth, so that heavy particle volume never tanks my framerate.
14. As a Player, I want the most recent hit to always show its burst even when the screen is already full of blood, so that my current action is never visually dropped.
15. As a Player in an offline single-player session, I want the exact same effects as in multiplayer, so that the experience is consistent across modes.
16. As a developer extending the game, I want to add a new kind of effect by registering a new ParticleType data profile, so that I don't have to touch the simulation or rendering code.
17. As a developer, I want one game event to be able to spawn several different ParticleTypes later, so that richer effects (e.g. blood plus debris on death) are possible without changing the wire protocol.
18. As a developer, I want effect emission to be authoritative and server-derived, so that clients cannot spoof or spam effects.
19. As a developer, I want effect-spawning logic to be shared, pure, and deterministic, so that the client's prediction and the server's authority always agree on what happened.
20. As a developer, I want the particle simulation to be a pure, headlessly-testable function, so that I can verify lifecycle and budget behavior without a terminal.
21. As a Player, I do not want blood to appear on hits that were blocked or absorbed by invulnerability frames, so that effects only fire on real damage.

## Implementation Decisions

These follow ADR 0013 (Particle effects) and the Effect / Particle / ParticleType
glossary entries in CONTEXT.md.

- **Two-layer model.** An **Effect** is a small, authoritative, deterministic
  descriptor of *what happened* — `{ kind, x, y, intensity, dir }` where `kind` is
  the semantic game event (`blood` for MVP), and `dir ∈ { -1, 0, 1 }` is the
  horizontal bias of the burst (**0 = radial**, used by death events). A
  **Particle** is the client-side, non-deterministic visual realization. A
  **ParticleType** is a declarative profile that fully defines a Particle's look
  and lifecycle. The Effect says what happened; the client decides what it looks
  like.

- **Emission in the shared Zone tick.** Effects are produced inside the shared
  `stepZone` simulation, at the exact sites where damage is applied (a hit only
  lands when the target is out of invulnerability frames, and damage is applied
  once per target per tick). The tick result gains a per-tick list of Effects
  alongside its existing deaths list. No separate hit-detection pass; no Effects on
  i-framed/blocked hits. `intensity` scales with damage dealt.

- **MVP Effects:** Monster-hit, Avatar-hurt, Monster-death (radial), Avatar-death
  (radial, spawned at the death position before the respawn teleport). All are the
  `blood` kind on an intensity continuum.

- **Effects travel inside the snapshot, server → client only.** They batch into
  the per-recipient snapshot that is already built every tick with Zone-interest
  filtering, so a blood Effect arrives in lockstep with the state change that
  caused it. This qualifies the wire protocol (ADR 0006): the snapshot message
  gains an Effects list. Client and server ship together, no version skew.

- **The server derives every Effect authoritatively; the client reports none
  upward.** The combat-authoritative server computes all Effects itself, closing
  the spoofing/spam surface. The client→server input message is unchanged.

- **Local prediction, narrowly scoped.** The acting Player predicts **only their
  own outgoing hits** client-side for zero-latency feedback. To de-duplicate, the
  server **suppresses the echo of an Effect back to its cause** while building that
  recipient's snapshot. **Incoming hurt is not predicted** — it renders from the
  snapshot, firing together with the existing hurt-flash. No rollback on
  mispredict (a stray decorative splat on a missed swing is acceptable).

- **Originator suppression lives in a pure per-recipient snapshot-building filter,**
  not inline in the WebSocket handler, so it is unit-testable without a socket.

- **Client particle simulation is non-deterministic and client-local.** Bursts are
  semantically identical across clients (right place, direction, intensity) but not
  pixel-identical; each client expands one Effect into specks with local
  randomness, at render framerate, in the imperative playfield render loop — not
  the 20 Hz sim. Particles reuse the client's existing terrain solidity check to
  land.

- **Data-driven ParticleType profiles.** One generic simulator reads a declarative
  profile per type: gravity, bounce/restitution, terrain collision, rest and fade
  durations, max lifetime, per-stage glyph sets, color-over-life curve, z-layer,
  launch speed/spread. The `blood` profile encodes the lifecycle: airborne → one
  small bounce (restitution ~0.4) → settle → rest (~2.5s) → fade (~0.75s) → cull;
  bright red darkening toward maroon as it settles. A client-side
  `Effect.kind → ParticleType[]` map (1:1 today) decouples the networked event from
  its look.

- **Rendering.** Two-pass z-order: resting/settling Particles draw just above
  terrain (behind sprites, so they read as on the floor); airborne Particles draw
  above sprites (erupting toward camera). Both always below speech bubbles and
  emotes so chat stays legible. Sub-cell float positions round to a cell and
  alpha-blend, so overlapping specks read as denser.

- **Performance budget.** A fixed, preallocated Particle pool (~2000) with no
  per-frame allocation; per-Effect count `clamp(base + intensity·scale, 1, ~24)`;
  Effects whose position is off-camera are **skipped entirely** (not spawned or
  simulated); when the pool is full, **evict the oldest** Particles so the newest
  action always renders.

- **Offline parity.** The offline single-player loop reads the same per-tick Effect
  list straight off the shared step result and feeds the client particle system
  directly — no wire involved, identical behavior to networked play.

## Testing Decisions

Good tests assert external behavior, not implementation details — emitted Effects
and observable Particle state, never exact glyphs or pixels. Three seams, the
highest available, two of them already established in the codebase:

- **Shared emission seam — the Zone tick (primary).** Combat is already tested
  here. Given a Zone state and intents, assert the emitted Effects: a Monster hit
  produces one `blood` Effect at the Monster with the correct `dir` and an
  `intensity` scaled by damage; a hit on an i-framed target produces **none**;
  Avatar-hurt, Monster-death (`dir = 0`), and Avatar-death each emit correctly.
  Pure and deterministic. Most coverage lives here.

- **Protocol round-trip seam (existing).** The binary codec already has round-trip
  tests; extend them to encode↔decode an Effect and a snapshot carrying Effects.

- **Client particle-system seam (one new seam).** The simulator is a pure function
  over `(particles, effects, dt, terrain, injected RNG)`. With a seeded RNG, it is
  fully headless and asserts non-pixel invariants: pool cap with evict-oldest,
  lifecycle transitions (airborne → bounce → settle → rest → fade → cull),
  off-camera Effects skipped, the `Effect.kind → ParticleType` spawn map, and
  **profile-driven behavior** — a second test ParticleType with different
  gravity/rest must behave differently from `blood` through the same simulator.

- **Originator suppression** is covered at the pure per-recipient snapshot-building
  filter (no live socket needed).

Rendering-to-cells is not pixel-tested; we assert the Particle state that feeds the
renderer. Headless checks use `@opentui/core/testing` where a render is needed.

## Out of Scope

- **Pixel-identical bursts across clients** — deliberately rejected; bursts are
  semantically equal, not lockstep-deterministic.
- **Client-predicted incoming hurt** — own-hurt is server-sourced to stay synced
  with the hurt-flash.
- **Clients reporting Effects to the server** — the server derives all Effects.
- **Rollback / reconciliation of mispredicted Effects.**
- **ParticleTypes beyond `blood`** (dust, sparkle, spark, smoke) — the system is
  built to accept them as data, but only `blood` ships now.
- **Non-combat Effects** (landing dust, level-up sparkle, projectile impact, block
  spark) — emit points deferred.
- **Optional per-type behavior hooks** for exotic motion (homing, splitting,
  per-particle custom fields) — the deferred extension path noted in ADR 0013;
  the data-driven profile covers MVP and the foreseeable roadmap.
- **Damage numbers / floating combat text** — a separate feature.
- **Bandwidth quantization of Effect coordinates** — floats on the wire for now,
  consistent with the current protocol.

## Further Notes

- **Interpolation timing wrinkle.** Remote entities render ~100 ms in the past
  (interpolation), but an Effect's position is absolute and renders at "now," so a
  remote Monster's blood can appear a hair ahead of where the Monster is drawn.
  It's decorative and tiny; optionally delay remote-Effect rendering by the same
  interpolation delay as polish. Not blocking.
- **Extensibility is the long game.** The whole point of the ParticleType profile
  registry and the `Effect.kind → ParticleType[]` indirection is that the next
  effect is a data entry and (if it's a new game moment) one new emit point — never
  a change to the simulator, the renderer, or the wire.
- See ADR 0013 (`docs/adr/0013-particle-effects.md`) for the architecture and the
  rejected alternatives, and the Effect / Particle / ParticleType entries in
  CONTEXT.md.
