---
status: accepted
---

# Premise and stack: a terminal MMO in TypeScript/Bun/OpenTUI, delivered by one command

A persistent PvE side-scrolling MMORPG played entirely in the terminal —
"MapleStory in a terminal" for developers. A hobby project optimizing for
coolness-per-effort and iteration speed, not feature completeness.

## Decisions

- **TypeScript on Bun across client, server, and shared packages.** One
  language means the wire protocol, physics, and combat formulas are written
  once and shared by both sides. Chosen for author fluency — iteration speed is
  the single biggest predictor of a hobby project getting finished.
- **Client TUI: OpenTUI** — game-grade (native Zig core via `bun:ffi`, no FPS
  cap, sub-ms frames). Consequence: the client runs on **Bun only**; no
  Node/`npx` path exists.
- **Transport: WebSocket with hand-rolled binary frames.** Persistence:
  `bun:sqlite`.
- **Delivery: `bunx terminal-mmo` — one bundled public package.** `bun build`
  inlines all first-party code into a single file (`workspace:*` doesn't
  survive publishing); `@opentui/core` stays external for its per-platform
  native binaries. Production server URL is baked in, so the bare command
  joins the live World; `MMO_SERVER`/`MMO_OFFLINE` override.
- **SSH-as-play was rejected on transport semantics**, not preference: an SSH
  session runs the program server-side, making client-side prediction
  impossible — every input pays a network round-trip, fatal for a jump-timing
  platformer. A web app was rejected because it isn't a terminal.
- **Crisp input requires the Kitty keyboard protocol** (key-release events).
  On terminals without it there is no smooth fallback — a held key is
  unobservable while another auto-repeats, so smoothness is physically
  impossible. The client shows a blocking every-launch notice nudging the
  player to a capable terminal, fail-open when detection is inconclusive.
  Hold-to-move stays the single control model.
