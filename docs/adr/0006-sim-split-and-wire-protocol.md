---
status: accepted
---

# Client/server sim-split and the M2 wire protocol

M2 puts a real server between the client and the simulation. The M1 loop was one
pure function, `step(game, input, dt)`, that coupled exactly one Avatar to one
Zone: it ran the Avatar's platformer physics *and* resolved every consequence
(Monster AI/HP, hits, Avatar HP/death/respawn, loot, XP). To realize the hybrid
authority of ADR 0001 — client owns its Avatar's position, server owns every
consequence — that single function has to split along the authority line, and the
two sides need a wire format. This ADR records both, and is the design-review
gate the downstream M2 slices build on.

## Decisions

- **Split the sim into two pure functions in `@mmo/shared`** (`zone.ts`), both
  deterministic and framework-free so client and server run identical logic:
  - **`stepZone(state, intents, dt)`** — the server-authoritative Zone step.
    Advances Monsters + Projectiles and owns every consequence for **N** reported
    Avatars: Monster AI/HP, hit resolution, Avatar HP / death / respawn, and
    loot/XP. Avatar position/facing are taken from each client's reported intent
    (never re-simulated); HP and vitals are server-owned.
  - **`clientStepAvatar(terrain, avatar, ctl, dt)`** — the thin client-local
    prediction: the existing platformer physics (`stepEntity`) plus local
    cooldown decay, so the own Avatar moves with zero input lag between snapshots.

- **One consequence engine, no divergence.** Single-player `step` is now a thin
  composition: predict the local Avatar's physics, then run a one-Avatar
  `stepZone`. The offline loop and the M2 server therefore execute the *same*
  consequence code — they cannot drift. (The full M1 test suite stays green,
  confirming the composition is behavior-identical.)

- **Wire protocol = a hand-rolled binary codec** (`protocol.ts`) over a
  `DataView`, shared by both sides, with a leading message-type tag. Floats are
  encoded as `f64` so `encode → decode` is exact and round-trippable. Message set:
  - **client → server:** `hello` (ephemeral handle — *revised by ADR 0004's
    amendment (#235): the Handle is now a durable, unique username claimed via
    SSH-key challenge-response, and the handshake gained `challenge`/`proof`
    messages*) · `input` (reported Avatar
    kinematics `x/y/vx/vy/facing/onGround` + the tick's `attack` / `skill` intents)
  - **server → client:** `welcome` (assigned session id, Zone id, tick rate) ·
    `snapshot` (authoritative Zone state — Avatars, Monsters, Projectiles — plus
    the recipient's private progress / inventory / log). Respawn surfaces as a
    position reset + a log line, so it needs no dedicated field.

- **Cadence (ADR 0002 / PRD).** The server ticks one Zone at **20 Hz** and streams
  a per-recipient snapshot each tick; the client renders decoupled at 30+ fps and
  predicts its own Avatar at full local rate. The server never simulates Avatar
  physics from input — a loose bounds clamp on the reported position is the only
  check.

- **Scope held to one Zone, last-hitter credit.** This slice runs a single Field
  Zone; cross-Zone routing / portals over the wire come later. A Monster kill
  credits XP + a loot roll to the Avatar landing the killing blow; full
  per-contributor instanced loot (PRD stories 26/27) is tracked as a separate
  issue. Skill cooldowns are predicted client-side for the telegraph and kept off
  the wire.

## Considered and rejected

- **A schema/codec library (protobuf, msgpack, flatbuffers).** Rejected for this
  slice: a hand-rolled codec is a few dozen lines, adds no dependency, gives full
  control of the byte layout, and is trivially round-trip testable. A schema lib
  becomes attractive once the message set churns or cross-language clients appear.
- **JSON text frames.** Easiest, but contradicts the "binary frames" decision
  (ADR 0002) and wastes bandwidth at 20 Hz. The hand-rolled codec costs little
  more and sets the right precedent.
- **Server-authoritative Avatar physics (simulate from raw input + reconcile).**
  Already rejected in ADR 0001 — the expensive netcode we explicitly avoid, and
  needless because Avatar position is uncontested (pass-through Avatars).
- **Keeping `step` and `stepZone` as separate consequence implementations.**
  Rejected: two copies of the combat/loot/progression logic is exactly the
  client/server drift the shared package exists to prevent.
- **Per-tick delta / quantized snapshots.** Deferred. Full `f64` snapshots are
  simple and correct at this scale; quantization and deltas are a bandwidth
  optimization for later.
- **Snapshot interpolation (render others ~100 ms in the past).** Deferred — this
  slice connects one Player, so there are no other Avatars to interpolate yet.

## Consequences

- `@mmo/shared` gains `protocol.ts` (wire codec) and `zone.ts` (`stepZone`,
  `clientStepAvatar`, session helpers `addAvatar` / `removeAvatar`, and
  `snapshotFor`). `sim.ts`'s `step` is now a composition over them.
- The server (`packages/server`) is a thin IO shell: a Bun WebSocket endpoint, a
  20 Hz `setInterval` driving `stepZone`, and session add/remove on connect/close.
  All game logic stays in `shared`; the testable seams (`stepZone`, `snapshotFor`,
  add/remove) are unit-tested, and the socket layer is validated by running it.
- The client gains an opt-in networked mode (`MMO_SERVER=ws://…`) that predicts
  its own Avatar and renders Monsters/Projectiles + its own vitals from snapshots;
  the offline single-player loop remains the default so nothing M1 breaks.
- Rendering co-present Avatars and cross-Zone routing are unblocked but not built:
  the snapshot already carries N Avatars, and the protocol is the agreed seam the
  next slices extend.
