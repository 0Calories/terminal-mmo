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
3. **Round-trip test every change** in `packages/core/test/protocol/protocol.test.ts`,
   including the truncated legacy form wherever a trailing field is optional.

A stale client is bounced with: *"Your client is out of date — run
`bunx terminal-mmo@latest`."* That message is the whole point of the version gate —
keep it actionable.

## Deployment

The server runs as a single always-on container on **Railway** (ADR 0009). The
live World is in-memory, but player saves are durable: a Release restarts the
process and drops sessions, but never destroys player state (ADR 0042).

- **Build: a `oven/bun` Dockerfile** (not Nixpacks — see ADR 0009 for why). Build
  and run it locally exactly as Railway does:
  ```bash
  docker build -t mmo .
  docker run --rm -p 8090:8080 -e PORT=8080 mmo
  curl localhost:8090/health   # -> ok
  ```
- **Deploys are explicit.** The service's watch paths are cleared; only the
  release pipeline's `railway up` (or the break-glass procedure below) deploys.
  The `/health` endpoint must return `200` or Railway fails the deploy.
- **Config**: `PORT` is injected by Railway. `MMO_DB_PATH` must point into the
  mounted volume (below). Optional overrides: `MMO_MAX_CONN` (default 200),
  `MMO_MAX_PER_IP` (default 10).

### Durable player saves (operator runbook)

**Volume setup** (one-time, per environment):

1. Mount a Railway volume on the service, e.g. at `/data`.
2. Set the service variable `MMO_DB_PATH=/data/mmo-state.sqlite`.
3. Delete the `MMO_VERSION` service variable — retired by the ADR 0042 release
   pipeline redesign; the build stamp replaces it.

**Boot snapshots.** Before opening the database, the server copies it to a
timestamped sibling on the same volume — `mmo-state.sqlite.<ISO timestamp>.bak`,
lexicographic order is chronological order — and prunes to the last 5. A `-wal`
sidecar, if present, is copied alongside as `<snapshot>-wal` (`-shm` is
transient and never copied; a clean shutdown checkpoints the WAL anyway, so the
sidecar only matters after a crash). A first boot with no DB file snapshots
nothing. A failed snapshot is logged loudly (`FAILED to snapshot player DB …`)
and the server **boots anyway** — a full volume must not take the game down,
but check the logs for that line after every deploy that touched storage.

**Save-schema policy.** Saves are JSON blobs that now outlive code: schema
changes must be additive (new fields only), readers must tolerate absent
fields, and a field's meaning is never repurposed. There are no migrations.

**Bad-data recovery** (a Release corrupted saves): roll code forward or back
first — rollback never touches the volume. If the *data* itself is bad:

1. Stop the service (scale to zero or pause deploys).
2. Pick the newest good snapshot on the volume and copy it over the DB path:
   `cp mmo-state.sqlite.<stamp>.bak mmo-state.sqlite` (plus its `-wal` sidecar
   if one exists; delete any stale `mmo-state.sqlite-wal` / `-shm` files).
3. Restart the service.

This accepts losing every save written since the boot that took the snapshot.

### Break-glass (manual deploy and rollback)

**Manual deploy** (the pipeline is down or distrusted):

```bash
bun run stamp                       # writes build-info.json from this checkout
bunx @railway/cli up --ci -y --no-gitignore --service <service>
```

Stamping first is mandatory: the boot guard refuses to start on Railway without
a stamp, so an unstamped `railway up` deploys a container that will not boot.
`--no-gitignore` is what carries the gitignored `build-info.json` into the
upload (`.railwayignore` holds the real exclusions).

**Rollback** is paired or single depending on whether the bad Release changed
the contract — `curl <prod>/health` and compare `contractHash` between the bad
and previous Releases to find out:

- **Contract changed:** the Railway rollback and
  `npm dist-tag add terminal-mmo@<prev> latest` must move **together**. A
  half-rollback fails the contract gate loudly for every player — better than
  silent drift, but still an outage.
- **Contract unchanged:** either side rolls back alone; the other keeps working.

Rollback never touches the volume. Bad *data* is recovered from the boot
snapshots per the runbook above.

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

## Engineering test strategy

Test at the highest deterministic seam that owns the behavior:

- Use a focused pure law in `@mmo/core` for simulation rules and invariants.
- Use a package integration test when the behavior crosses public modules within
  one package, such as protocol encoding or render composition.
- Use an in-memory stack scenario only when the behavior must cross client,
  protocol, server runtime, and authoritative World boundaries.

Keep one happy-path proof at that seam instead of repeating it at every layer.
Add narrower tests only for distinct edge cases. Prefer relational and
configuration-derived outcomes over copied literals so tests remain valid when
balanced values change.

### Forge interactive terminal check

Forge's headless tests verify authored documents, input parity, modal completion,
and degradation state. They cannot prove how a terminal emulator renders tool
glyphs and colours or how its native mouse capture behaves during a real drag.
Before shipping Forge interaction or chrome changes, run these in a real terminal:

```bash
bun run forge sprite glyphs
bun run forge sprite edit hat/<sprite-id>
```

Confirm that tool glyphs occupy one column without tofu, colours and transparent
areas remain legible, keyboard focus is visible, and mouse press/drag/release is
continuous when the pointer crosses the canvas and preview pane.

## Canonical visual golden

`packages/client/test/golden/playfield.txt` is the one broad pixel-level review
artifact. It renders real shipped Sprite files in a composed scene with a manual
clock and seeded randomness, so repeated runs are byte-for-byte deterministic.

When the golden test fails, inspect the text diff first. Fix the rendering or
asset regression when the visual change was unintended. When the change is
intentional, regenerate it with:

```bash
bun run test:golden:update
```

Review the regenerated diff before accepting it; regeneration records approval
of the new broad scene, not proof that every changed glyph is correct. Keep other
rendering tests semantic—do not add component-level pixel snapshots.

## Conventions

- Game logic is pure/deterministic in `@mmo/core` so client and server can't
  diverge. Test behavior there, not rendering.
- Design docs are the source of truth: [`CONTEXT.md`](./CONTEXT.md) (glossary)
  and accepted [`docs/adr/`](./docs/adr/) (product scope and architecture
  decisions).
