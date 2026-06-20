# terminal-mmo

A persistent PvE side-scrolling MMORPG played entirely in the terminal —
"MapleStory in a terminal," for developers. Pet project.

> **Design docs are the source of truth:**
> [`CONTEXT.md`](./CONTEXT.md) (glossary) · [`docs/PRD.md`](./docs/PRD.md) ·
> [`docs/adr/`](./docs/adr/) (architecture decisions).

## Layout

```
packages/
  shared/   @mmo/shared — deterministic game logic (single source of truth)
  client/   @mmo/client — OpenTUI terminal client (rendering + input)
  server/   @mmo/server — placeholder for M2 (multiplayer foundation)
spike/      M0 OpenTUI go/no-go spike (disposable; see spike/FINDINGS.md)
```

The `shared` package holds all simulation (physics, combat, loot, progression) as
pure, deterministic functions so client and server can never diverge.

## Commands

```bash
bun install            # install workspace deps
bun test               # run the shared simulation test suite
bun run typecheck      # typecheck all packages
bun run dev:client     # play the single-player loop (run in a REAL terminal)
```

## Status: M1 (single-player core loop)

Playable: Warrior movement/jumping, forgiving melee, chaser monsters, kill → XP →
level → instanced loot, forgiving death. No netcode yet (that's M2).

Stubbed / TODO in M1: shooter archetype + projectiles, monster respawn timers,
Town + NPC vendor, Warrior skills, multiple Zones.
