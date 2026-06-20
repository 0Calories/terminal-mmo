---
status: accepted
---

# Tech stack: TypeScript / Bun / OpenTUI, with installed-client delivery (no SSH play)

A solo pet project optimizing for iteration speed (single biggest predictor of a
pet project getting finished) and a demoable, responsive real-time platformer.

## Decisions

- **Language & runtime: TypeScript on Bun**, across client, server, and a shared
  package. Chosen primarily for the author's fluency (iteration speed). One
  language means the wire protocol, physics constants, and combat formulas are
  written once and shared by both sides.
- **Client TUI: OpenTUI.** Verified game-grade: native Zig core via Bun FFI, no
  FPS cap, sub-ms frame times, an imperative API + primitives (FrameBuffer for
  low-level cell drawing), dedicated keyboard input, animation timelines.
- **Server: Bun** (WebSocket server on uWebSockets; ~1,000 connections is
  comfortable).
- **Transport: WebSocket** (binary frames).
- **Persistence: `bun:sqlite`** for v1; Postgres later only if needed.
- **Delivery: `bunx <game>` and/or a `bun build --compile` single-file binary.**
  Gives near-zero-friction onboarding for a developer audience while keeping the
  real client local (responsive).
- **De-risk OpenTUI with a rendering spike as the first build step**: a scrolling
  camera following one locally-controlled sprite over terrain at 30+fps. Proves
  the foundation before committing further; one day spent, not one month.

## Considered and rejected

- **Go + Charm (Bubble Tea / Wish).** Excellent fit on the merits (goroutine-per-Zone,
  single static binary, premier TUI ecosystem) and was held open *only* for the
  SSH-delivery possibility. Rejected once SSH-as-play was ruled out (below),
  leaving author fluency as the deciding factor → TypeScript.
- **SSH as the play/render path (incl. Charm Wish).** Rejected on transport
  semantics, not preference: an SSH session runs the program server-side and the
  local terminal is a dumb display, so client-side prediction is impossible and
  every input incurs a full network round-trip. Fatal for a jump-timing
  platformer, and identical in Go or TS. SSH "delivering a client you then run
  locally" collapses to being just a download channel (no better than `bunx`).
- **Web app.** The only zero-install + locally-responsive option, but it is not a
  terminal — contradicts the project's premise.

## Consequences

- Bun's server is a single-threaded event loop: Zones tick cooperatively, not in
  true-parallel goroutines. Fine at ~1,000 players with light per-tick work; the
  escape hatch (Bun Workers / Zones-across-processes) is clean because ADR 0001
  made Zones independent sims.
- OpenTUI is newer / less battle-tested than Bubble Tea or Ratatui and its docs
  are thin in places; accepted as an early-adopter pet-project risk, mitigated by
  the spike-first plan.
- **Parked future option:** SSH *keys* as an auth + transport layer for the
  installed client ("authenticate with your SSH key") — developer-native identity,
  to be revisited in the accounts/auth branch. Does not provide zero-install.
- A degraded SSH *spectator* mode remains possible later as a party trick, not as
  how the game is played.
