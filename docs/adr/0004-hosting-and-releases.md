---
status: accepted
---

# Hosting and releases: Railway, contract-hash compatibility, selective shipping

## Decisions

- **Host: Railway** — one always-on container holding the long-lived WebSocket
  and in-memory tick loop, on a Railway `wss://` domain. Serverless is an
  architecture mismatch (short-lived stateless invocations can't hold a
  ticking shared World); spin-down free tiers were rejected because a presence
  game must never cold-start. Built with an **`oven/bun` Dockerfile** (not
  Nixpacks, whose Bun provider drags in a broken Node toolchain); the server
  binds `process.env.PORT` and serves `200` on `/health`.
- **The client/server compatibility gate is a content-derived contract hash,
  not a version number.** The **release contract** — `@mmo/core` sources, zone
  data, server-consumed sprite metadata — is hashed on both sides; `hello`
  carries the client's hash and the server rejects a mismatch loudly ("run
  `bunx terminal-mmo@latest`"). Version numbers are human-facing labels only.
  This replaced two earlier gates (a hand-bumped protocol integer, then
  tag-derived Version equality) after each detached from the content it was a
  proxy for — the Version gate shipped a silent production outage when a
  stale image "passed" as the new version. The hash compares actual content
  at every handshake; the same check runs identically in production and
  localhost (no environment-conditional gate behavior exists).
- **The contract boundary is a committed manifest in `@mmo/core`** classifying
  every repo path (`contract` / `server-only` / `client-only` / `neither`);
  CI fails on any unclassifiable tracked path, and ambiguity errs into the
  contract (over-triggering a dual ship is safe; silent drift is not).
- **Releases ship selectively; the shape is computed from the diff, not
  chosen.** Contract changes ship both artifacts; server-only changes deploy
  without publishing; client-only changes publish without restarting the
  server (nobody is kicked for an art tweak); doc-only Releases are no-ops.
- **Deploy first, publish last** — gate the irreversible `npm publish` on the
  retryable Railway deploy; a failed deploy burns no npm version. Publishing
  uses **OIDC Trusted Publishing** (no long-lived token). Every artifact
  carries a **build stamp** (`version`, `gitSha`, `contractHash`); the server
  refuses to boot on Railway unstamped or when the stamp disagrees with its
  loaded content, and `/health` reports the running stamp recomputed from
  live assets.
- **Recovery is roll-forward, with a documented never-automated break-glass**:
  if the bad Release changed the contract, the Railway rollback and the npm
  `latest` dist-tag move together; if not, either side rolls back alone.
  Rollback never touches the save volume; bad data restores from boot
  snapshots (ADR 0003). Operational runbook: CONTRIBUTING.md.
