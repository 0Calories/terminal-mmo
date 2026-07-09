---
status: accepted
---

# Going live: an ephemeral alpha on Railway, delivered by `bunx`

> Vocabulary: [`CONTEXT.md`](../../CONTEXT.md) — World, Handle, session id.
> Builds on ADR 0002 (tech stack / `bunx` delivery), ADR 0004 (SSH-key auth,
> deferred here), ADR 0006 (sim split & wire protocol).

The game runs only on `localhost`: the [server](../../packages/server/src/index.ts)
holds an **in-memory** [World](../../CONTEXT.md) with no persistence and no auth
(a session id is an auto-incrementing integer; `hello` carries an arbitrary
[Handle](../../CONTEXT.md)), and the client is an unpublished, `private` workspace
package that defaults to *offline* single-player. This ADR records how we put a
shared World on the public internet and let a stranger join it in one command —
the **first live cut**, deliberately scoped as a throwaway alpha so the exciting
milestone (another human's Avatar moving in your terminal, over the internet) is
not gated behind accounts and a database.

## Decisions

- **First live cut is an ephemeral, anonymous playground — explicitly v0.** No
  persistence, no auth: anonymous Handles (defaulting to `$USER`) over the
  existing in-memory World. A server restart wipes everything; this is labeled
  "alpha — progress will reset" in-client and in the README. **Durable identity
  is one combined follow-up, not part of launch**: persistence without a stable
  identity to attach it to is pointless, so `bun:sqlite` persistence and SSH-key
  auth (ADR 0004) ship together as the next branch — not piecemeal.

- **Host: Railway.** A single always-on container running the Bun process, with
  its long-lived WebSocket and 20 Hz in-memory tick loop, on a Railway-provided
  `wss://` domain (TLS terminated for us). Effectively ~$5/mo (the Hobby plan
  bundles $5 of usage, which a small single process sits inside). Chosen for
  developer experience on a Bun app over the few-dollars saving of a raw VM.

- **Build & run: a `oven/bun` Dockerfile.** Railway builds the image and runs
  `bun run packages/server/src/index.ts`, healthchecking `/health`. Two fixes the
  server needed to survive on Railway: **bind `process.env.PORT`** (Railway injects
  it; the server originally read only `MMO_PORT`/8080, so it was unreachable), and
  **serve a `200` healthcheck** (a plain HTTP GET returned `426`, which fails
  Railway's healthcheck and restart-loops).

  > **Nixpacks → Dockerfile.** This started as Nixpacks (autodetect Bun from
  > `bun.lock`), the lower-ceremony path. It failed at build: Nixpacks' Bun
  > provider still provisions a Node toolchain, and the Node 18 it selected has
  > been removed from the pinned nixpkgs (EOL), so the Nix derivation errored. The
  > `oven/bun` image gives a controlled, Node-free runtime and is portable off
  > Railway — the Dockerfile fallback this ADR already anticipated.

- **Delivery: `bunx terminal-mmo`, and nothing else, for v0.** The client renders
  through `@opentui/core`, a native Zig library loaded via `bun:ffi` — so it runs
  on **Bun only** (no Node/`npx` path exists). `bunx` therefore assumes the player
  has Bun (a one-line `curl … bun.sh/install` for those who don't — acceptable for
  a developer audience). Compiled `bun build --compile` binaries are deferred: in
  an alpha whose binary wire protocol churns, `bunx`'s always-fetch-latest keeps
  client and server in lockstep, whereas stale binaries in the wild would silently
  mis-decode frames.

- **Published artifact: one bundled public package, `terminal-mmo`.** `bun build`
  inlines our first-party code — the client **and** `@mmo/core` — into a single
  file, sidestepping the `workspace:*` protocol that does not survive publishing.
  `@opentui/core` stays an external `dependency` because it ships its native
  renderer as platform-specific `optionalDependencies` (resolved per OS/arch at
  install). `@mmo/core` and `@mmo/server` stay private and never reach npm. The
  package is `{ "bin": { "terminal-mmo": "./dist/cli.js" }, "dependencies": {
  "@opentui/core": "0.4.1" } }`.

- **Client connection config: production by default, dev by override.** The
  production `wss://` URL is baked into the bundle as the default, so `bunx
  terminal-mmo` with no args joins the live World. Resolution order: `MMO_OFFLINE`
  → the single-player loop; else `MMO_SERVER` → that URL (local dev against your
  own server); else → the baked-in production URL. This inverts today's default
  (offline when `MMO_SERVER` is unset). Changing hosts later means a re-publish —
  acceptable, since every protocol change already forces one.

- **Protocol-version gate.** A `PROTOCOL_VERSION` constant in `@mmo/core`,
  hand-bumped on every wire-format change, is carried on `hello`. On mismatch the
  server sends a new `reject` message (human reason) and closes; the client prints
  "Your client is out of date — run `bunx terminal-mmo@latest`" and exits. Because
  `bunx` caches packages, a returning player running a stale client against a newer
  server is the *expected* steady state during alpha — and a binary protocol has no
  safe partial decode, so a mismatch must fail loudly, not garble.

- **Abuse: two connection caps, the rest deferred.** A **global** concurrent-session
  cap protects the single-threaded event loop from exhaustion, and a **per-IP cap
  of 10** (read from `X-Forwarded-For`, since Railway's proxy hides the socket
  peer) kills single-actor multi-connect floods without punishing shared NAT /
  CGNAT (where many legitimate developers share one IP). Both reuse the `reject`
  path ("server full"). This is a **soft** guardrail — `X-Forwarded-For` is
  client-spoofable — accepted because real per-identity control needs the deferred
  auth branch anyway. Handle sanitization, per-session rate limiting, and per-IP
  enforcement that resists spoofing come later.

## Considered and rejected

- **Vercel (and serverless generally).** An architecture mismatch, not a tier
  limit: serverless runs short-lived, stateless, per-request invocations that
  cannot hold a long-lived WebSocket and have no shared, always-ticking in-memory
  World — two players would land in two isolated instances and never see each
  other. (Vercel is fine for a later static landing/install page — just not the
  tick server.)

- **Spin-down free tiers (Render free, etc.).** Genuinely $0, but they sleep the
  process after idle and cold-start on the next request. For a *presence* game
  whose whole appeal is "someone is already in here," a sleeping server is the
  worst failure mode.

- **Oracle Cloud Always Free VM / Fly.io.** Both viable always-on hosts. Oracle is
  truly $0 but pays for it in raw VM ops (OS patching, systemd, TLS, deploys);
  Fly is metered-from-zero and a fine alternative. Railway won on DX for a Bun app;
  Oracle is the documented `$0`-if-you-want-ops fallback.

- **Durable accounts at launch (persistence + auth first).** Triples the scope of
  the milestone we're most eager to see and delays "another human in my terminal"
  behind a database and a key-exchange. Deferred as the immediate next branch.

- **Compiled single-file binaries (`bun build --compile`) at launch.** Zero
  prerequisites, but no auto-update: stale binaries would silently fail against a
  churning binary protocol. A post-alpha nicety once the protocol stabilizes.

- **Publishing `@mmo/core` as its own public package.** Forces a versioned
  double-publish on every protocol change for no benefit — `shared` is internal
  plumbing, not a public API. Bundling keeps client and shared in sync from one
  commit and ships one artifact.

- **Strict 1-connection-per-IP.** Bounces the second player behind any shared
  network (office, home wifi, CGNAT) — a likely first-day developer scenario — and
  buys a "one avatar per person" guarantee it cannot actually deliver without auth.
  A small cap (10) defends the process without the false guarantee.

## Consequences

- `@mmo/core` gains `PROTOCOL_VERSION` and a `reject` server message; `hello`
  grows a `protocol` field. The version constant must be bumped with every
  wire-format change (alongside the published package version).
- `packages/server/src/index.ts` changes: read `process.env.PORT`, serve a `200`
  healthcheck, enforce the global + per-IP caps via `X-Forwarded-For`, and gate on
  `PROTOCOL_VERSION`.
- A new publishable `terminal-mmo` package (e.g. `packages/cli`) carries a `bun
  build` step, a `#!/usr/bin/env bun` shebang, the `bin`, and `@opentui/core` as
  its lone runtime dependency. Publishing is manual (`bun publish`) for alpha.
- The client's connection default flips from offline to the baked-in production
  URL, with `MMO_OFFLINE` preserving the single-player loop.
- A repo-root deploy config (root `start` script; Railway service settings) and an
  "alpha — progress resets" notice in-client and in the README.
- **Next branch:** SSH-key auth (ADR 0004) + `bun:sqlite` persistence, shipped
  together, to turn the playground into durable accounts.
