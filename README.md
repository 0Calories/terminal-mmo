# terminal-mmo

A persistent PvE side-scrolling MMORPG played entirely in the terminal —
"MapleStory in a terminal," for developers. Pet project.

> **Design docs are the source of truth:**
> [`CONTEXT.md`](./CONTEXT.md) (glossary) · accepted
> [`docs/adr/`](./docs/adr/) (product scope and architecture decisions).

## Play

```bash
bunx terminal-mmo@latest
```

That's it — you drop straight into the live, shared World. The client runs on
[Bun](https://bun.sh) (the renderer is a native library loaded via `bun:ffi`), so
if you don't have it yet:

```bash
curl -fsSL https://bun.sh/install | bash   # then: bunx terminal-mmo@latest
```

> ⚠️ **Alpha.** The World is ephemeral — there is no login and no saved progress
> yet. When the server restarts, everyone starts fresh. Identity (SSH-key auth)
> and persistence are the next milestone. See
> [ADR 0009](./docs/adr/0009-live-hosting-and-bunx-delivery.md).

Environment overrides: `MMO_SERVER=ws://localhost:8080` to point at your own
server.

In-game: press `m` to mute and `o` to open the audio options (master + per-bus
volume). These prefs persist to `~/.config/terminal-mmo/config.json` (honoring
`XDG_CONFIG_HOME`) — the only thing the client writes to your disk
([ADR 0015](./docs/adr/0015-client-config-file.md)).

## Layout

```
packages/
  core/       @mmo/core — deterministic game logic + wire protocol (single source of truth)
  render/     @mmo/render — presentation: sprite art + drawing (client + forge, never the server)
  client/     @mmo/client — OpenTUI terminal client (rendering + input + netcode)
  server/     @mmo/server — authoritative Bun WebSocket world (M2)
  cli/        terminal-mmo — the published bundle for `bunx` (ADR 0009)
  forge/      @mmo/forge — content authoring suite: zones now; sprites/NPCs/quests next
```

The `core` package holds all simulation (physics, combat, loot, progression) as
pure, deterministic functions so client and server can never diverge; `render`
holds the sprite art and drawing code on top of it (ADR 0030).

## Commands

```bash
bun install            # install workspace deps
bun test               # run the shared simulation test suite
bun run typecheck      # typecheck all packages
bun run dev:client     # play the client against a server (run in a REAL terminal)
MMO_GUEST=1 bun run dev:client   # second local client with a throwaway identity (nothing saved)
bun run lint           # lint with Biome
bun run format         # format in place with Biome
bun run check          # lint + format + organize imports, write fixes (Biome)
```

## Status: M2 (multiplayer foundation), going live

Playable in a shared World over WebSocket: Warrior movement/jumping, forgiving
melee, chaser + shooter monsters, kill → XP → level → instanced loot, forgiving
death, Town + NPC vendor, Zone-local chat with speech bubbles, portal travel.

Going live now (ADR 0009): the server deploys to Railway and the client ships as
`bunx terminal-mmo`. This first cut is an **ephemeral, anonymous alpha** — no
accounts, no persistence. Next milestone: SSH-key identity + saved progress.
