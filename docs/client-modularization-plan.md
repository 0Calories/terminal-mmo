# Client modularization — build plan

Kill the two client god files (`playfield.ts`, `index.ts`), give the client a
feature-folder layout, and — as foundation work — split presentation out of the
shared package and move combat presentation client-side. Decisions are recorded in
**ADR 0029** (CombatEvents on the wire) and **ADR 0030** (core/render split);
vocabulary churn (retire `Effect`, add `VisualEffect`, `CombatEvent` now on-wire) is
in `CONTEXT.md`.

## Target client layout

```
client/src/
  ui/        hud, message-log, controls, shop, customize, character-creator,
             no-kitty notice, speech-bubble drawing (from playfield)
  input/     movement (InputState) + UI-interaction (menu/modal/chat-typing keys
             from index.ts) + chat parse + no-kitty probe
  effects/   VisualEffect facade: generic particle engine + realization adapter,
             camera-kick + hitstop (view), effectsOf (from @mmo/core), drawParticles
  render/    core zone/entity/nameplate draw loop (surviving heart of playfield.ts)
             + camera follow + speech-bubble drawing
  net/       net.ts (+ chat send/recv), interp.ts
  game/      loop.ts (tick loop) + predict.ts (client physics/combat prediction)
  sound/     SoundEffect (existing)
  index.ts   thin: boot renderer, wire subsystems, start loop
```

Packages: **@mmo/core** (sim; server + client + forge) + **@mmo/render** (art +
drawing; client + forge). Chat is cross-layer: parse → `input`, wire → `net`, log →
`ui`. `input` has two concerns — movement, and UI-interaction (menus + chat typing).

## Non-goals on the client

- **physics** and **live sprites** already live in the shared package (deterministic;
  server/client agree). They are *not* client folders — the client only calls physics
  (in `game/predict.ts`) and holds sprite *preview* helpers.
- Zone files stay top-level content loaded via `@mmo/core`; they are not presentation.

## Phases (each its own PR, each independently green)

| # | Phase | Scope | Risk | Gate |
|---|-------|-------|------|------|
| 0 | Baseline: seeded golden-frame test + owner/observer determinism test on current code | client | none | frame committed |
| 1 | Client carve — relocate into folders, split god-files (behavior-preserving) | client | low | `ci` + golden identical + TUI smoke |
| 2 | Effects redesign — VisualEffect 3-tier facade; `render` composes `effects` | client | med | golden identical + determinism + `ci` |
| 3 | core/render package split (ADR 0030); dependency-cruiser rule | core + forge + server | high | all `ci` + `zones:check` + smoke client & forge |
| 4 | CombatEvent on the wire (ADR 0029); `effectsOf` → client; server presentation removed | core + server + client | high | golden identical + determinism + all `ci` + smoke a real hit |

**Order rationale:** client-only and safe (1–2) before cross-package and semantic
(3–4); never two big diffs at once. Phase 4's `effectsOf` lands in the Phase-2 facade
and leaves the Phase-3 core boundary cleanly. Phase 1 alone already delivers "no god
files."

## Verification

- **`bun run ci`** (`biome ci && typecheck && bun test && zones:check`) after every phase.
- **Seeded golden frame** (Phase 0, committed): fixed zone + entities + scripted
  CombatEvent + seeded RNG → char buffer via `@opentui/core/testing`; assert
  byte-identical after each phase. This is the proof that the effects redesign and
  CombatEvent-on-wire don't change what players see. (`ParticleSystem.spawn` already
  takes an `rng` param, so seeding makes particle frames deterministic.)
- **Determinism test**: same CombatEvent → identical VisualEffect for owner-predict vs
  observer-receive — guards ADR 0019's agreement invariant as `effectsOf` moves client-side.
- **Manual TUI smoke** (phases touching input/loop/wire): `dev:client` vs `dev:server`
  — move / jump / attack / dodge / open modal / chat must feel identical.
- **Cross-package phases** additionally smoke **forge** (`zones:preview` / `zones:edit`).
