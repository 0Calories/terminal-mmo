# Contributing

## Wire protocol changes (read before touching `protocol.ts`)

The client ships as `bunx terminal-mmo` and is **cached** on players' machines, so
a returning player can run an old client against a freshly-deployed server. The
wire protocol is hand-rolled binary frames — a mismatch doesn't fail cleanly, it
silently mis-decodes bytes into garbage. To prevent that, every connection
carries a `PROTOCOL_VERSION` and the server rejects mismatches loudly (ADR
[0009](./docs/adr/0009-live-hosting-and-bunx-delivery.md)).

**Any time you change the wire format** — add/remove/reorder a field, change a
type, add a message — follow this checklist, in order:

1. **Bump `PROTOCOL_VERSION`** in `packages/shared/src/protocol.ts`.
2. **Bump the `version`** of the publishable package in `packages/cli/package.json`.
3. **Deploy the server first** (merge to `main` → Railway redeploys). The new
   server must be live *before* the new client exists, so it can reject stragglers
   on the old version.
4. **Then publish the client**: `cd packages/cli && npm publish`.

If you publish before redeploying, the new client will be rejected by the still-old
server. Server-first is the safe order.

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
MMO_SERVER=ws://localhost:8080 bun run dev:client   # play against it
MMO_OFFLINE=1 bun run dev:client         # single-player, no network
bun test && bun run typecheck && bun run ci
```

## Conventions

- Game logic is pure/deterministic in `@mmo/shared` so client and server can't
  diverge. Test behavior there, not rendering.
- Design docs are the source of truth: [`CONTEXT.md`](./CONTEXT.md) (glossary),
  [`docs/PRD.md`](./docs/PRD.md), [`docs/adr/`](./docs/adr/).
