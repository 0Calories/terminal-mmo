# Contributing

## Wire protocol changes (read before touching `protocol.ts`)

The client ships as `bunx terminal-mmo` and is **cached** on players' machines, so
a returning player can run an old client against a freshly-deployed server. The
wire protocol is hand-rolled binary frames — a mismatch doesn't fail cleanly, it
silently mis-decodes bytes into garbage. To prevent that, `hello` carries the
client's release **Version** (sourced from the git tag — ADR
[0012](./docs/adr/0012-release-versioning-and-cicd.md), which replaced the old
hand-bumped `PROTOCOL_VERSION` integer) and a deployed server rejects a mismatch
loudly (ADR [0009](./docs/adr/0009-live-hosting-and-bunx-delivery.md)).

**Any time you change the wire format** — add/remove/reorder a field, change a
type, add a message — keep to these rules:

1. **No manual version bump.** The gate is intrinsic to cutting a release tag:
   the pipeline deploys the server first and only publishes the client once
   `/health` reports the new Version (ADR 0012). A dev server (`MMO_VERSION`
   unset) skips the gate, so local dev is never rejected.
2. **Append, don't reorder.** A new field goes at the END of its message (and a
   new catalog entry at the end of its table), with a `remaining()` guard on
   decode — so an old frame still decodes cleanly and the version gate, not a
   garbled read, is what refuses a stale peer.
3. **Round-trip test every change** in `packages/core/test/protocol.test.ts`,
   including the truncated legacy form wherever a trailing field is optional.

A stale client is bounced with: *"Your client is out of date — run
`bunx terminal-mmo@latest`."* That message is the whole point of the version gate —
keep it actionable.

## Deployment

The server runs as a single always-on container on **Railway** (ADR 0009). It's
stateless — the alpha World is in-memory, so a redeploy just wipes everyone's
progress (expected, for now).

- **Build: a `oven/bun` Dockerfile** (not Nixpacks — see ADR 0009 for why). Build
  and run it locally exactly as Railway does:
  ```bash
  docker build -t mmo .
  docker run --rm -p 8090:8080 -e PORT=8080 mmo
  curl localhost:8090/health   # -> ok
  ```
- **Redeploy** happens on merge to `main` (Railway tracks the branch). The
  `/health` endpoint must return `200` or Railway fails the deploy.
- **Config**: `PORT` is injected by Railway. Optional overrides: `MMO_MAX_CONN`
  (default 200), `MMO_MAX_PER_IP` (default 10).

## Local development

```bash
bun install
bun run dev:server                       # ws://localhost:8080
bun run dev:client                       # from-source clients default to the local server
MMO_SERVER=ws://host:port bun run dev:client   # ...or point at another server
bun test && bun run typecheck && bun run ci
```

A from-source (`dev`) client defaults to the local dev server, since a deployed
server rejects a `dev` client at its version gate (ADR 0012). Set `MMO_SERVER` to
override the target.

## Conventions

- Game logic is pure/deterministic in `@mmo/core` so client and server can't
  diverge. Test behavior there, not rendering.
- Design docs are the source of truth: [`CONTEXT.md`](./CONTEXT.md) (glossary),
  [`docs/PRD.md`](./docs/PRD.md), [`docs/adr/`](./docs/adr/).
