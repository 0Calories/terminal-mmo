---
status: accepted
---

# Release versioning & CI/CD: tag-driven atomic releases, gated on version equality

> Vocabulary: [`CONTEXT.md`](../../CONTEXT.md) — World, Handle, session id.
> Amends [ADR 0009](./0009-live-hosting-and-bunx-delivery.md): replaces the
> hand-bumped `PROTOCOL_VERSION` gate and the manual `bun publish`.

ADR 0009 shipped the live alpha with two **decoupled** delivery paths: the server
auto-deploys to Railway on every push to `main`, while the published
`terminal-mmo` client is a **manual** `bun publish`. Compatibility was policed by a
hand-bumped `PROTOCOL_VERSION` constant carried on `hello`, exact-matched by the
server.

That decoupling has a failure mode we hit in practice: a change bumped
`PROTOCOL_VERSION`, merged to `main`, and Railway redeployed the server to the new
protocol — but the client was never re-published, so the newest *published* client
was a protocol behind and **every `bunx` player was rejected** until a human
remembered to publish. This ADR records how releases become a single automated,
atomic, versioned act, and folds the protocol version into the release version.

## Decisions

- **Keep the strict, fail-loud gate; fix this at the release layer, not the
  protocol layer.** ADR 0009 deliberately chose exact-match rejection because a
  binary frame has no safe partial decode. We do **not** add backward-compatible
  version negotiation (a window of supported versions). The bug was *uncoupled
  automation*, not strictness — so the fix is to couple publish and deploy, and
  leave the wire format strict.

- **A Release is one atomic, tag-triggered pipeline.** Pushing a `v*` tag (e.g.
  `v0.3.0`) is the *only* thing that ships. A push/merge to `main` runs **CI only**
  — it never publishes and never deploys. Railway's auto-deploy-on-push is turned
  **off**; deploying the server becomes a step *inside* the release pipeline. A
  protocol-incompatible Release kicks every connected player to "upgrade", so
  cutting one is a deliberate, named act — not a side effect of merging.

- **One `main` + release tags; no `development` branch.** PRs merge to `main` (the
  integration line); a tag cuts the Release. The "merged but not yet released" set
  is exactly `git log <latest-tag>..main`. A second long-lived branch (GitFlow)
  buys a "production branch" we don't need now that the trusted production ref is
  the **tag**, not a branch — and costs perpetual sync + a fiddly hotfix story.

- **One repo-wide Version; the git tag is the sole source of truth.** Tag `v0.3.0`
  → the pipeline stamps `0.3.0` into the published client *and* into the server
  build (exposed at `/health`). Nothing version-related is hand-maintained in a
  committed file — the version in `packages/cli/package.json` is a vestige the
  pipeline overwrites. The private `client`/`server`/`shared` packages stay
  `0.0.0`. We release one coupled unit, so one number describes it.

- **`PROTOCOL_VERSION` is deleted; the compatibility gate is Version equality.**
  Because the version now comes from the tag, the bump is *intrinsic to releasing*
  — you cannot ship a wire change without cutting a new tag — so the old
  "forgot to hand-bump the constant" footgun stops existing rather than being
  guarded against. `hello` carries a Version **string** instead of `protocol:
  number` (the last hand-made wire change); the server rejects on
  `client.version !== server.version`. A given Version's client and server are
  built from one commit, so within a Version they cannot disagree.

- **The server trusts itself locally; only the deployed server gates.** When the
  server's own Version is the dev sentinel (`MMO_VERSION` unset → `0.0.0`/`dev`) it
  **skips the gate** and accepts any client. Local dev (including a dev client
  pointed at `ws://localhost`) is never rejected; the gate bites in exactly one
  place — the Railway deployment, where the pipeline sets `MMO_VERSION`.

- **Deploy first, publish last — gate the irreversible step on the reversible
  one.** The pipeline deploys the server to Railway *before* publishing the client,
  because (1) `npm publish` is effectively irreversible (unpublish is restricted
  and poisons `bunx` caches) while a Railway deploy is freely retryable, and (2)
  the slow deploy runs while old client and old server are still consistent, so the
  unavoidable inconsistent window shrinks from "the whole deploy" (minutes) to
  "just the publish" (seconds). If the deploy fails, *nothing was published* — fix
  and re-tag, no npm version burned.

- **`/health` reports the Version; the pipeline asserts it equals the tag before
  publishing.** This is where the safety deleted with `PROTOCOL_VERSION` relocates:
  the version-match check catches "a stale or wrong build got deployed" before an
  irreversible publish, and — since the gate is pure equality — `/health == vN` is
  proof a `vN` client will be accepted. No `@next` pre-release channel yet (it adds
  a manual promotion step that fights the automation goal).

- **npm auth via Trusted Publishing (OIDC), not a long-lived token.** The release
  workflow requests a short-lived OIDC identity token (`id-token: write`) that npm
  exchanges for a single-use publish credential and uses to stamp build provenance —
  so there is no `NPM_TOKEN` secret to leak or rotate. The trade-off: the trusted
  publisher is bound to a specific workflow *file path* registered on the package,
  so the publish must live in a committed workflow at that path (`release.yml`).

- **CI is the full gate, unified in one script.** `bun run ci` becomes `biome ci .
  && bun run typecheck && bun test && bun run zones:check` — the same definition
  locally and in GitHub Actions, run as a required status check on PRs to `main`.

- **CI runs as one job with independent, always-run steps.** Each check is its own
  step (so the run UI shows which dimension failed, and all run despite an earlier
  failure) on a single runner (one checkout/install). Splitting into parallel jobs
  is deferred until an individual check crosses ~1–2 min, where the per-job setup
  overhead stops dominating — each step is already `bun run <x>`, so promoting one
  to its own job is mechanical.

- **Recovery is roll-forward, with a documented manual break-glass.** A bad-but-
  healthy Release is fixed by cutting `v(N+1)` (~10–15 min; the ephemeral World
  wipes on deploy anyway, so there is no durable state to protect by reverting
  fast). The break-glass for "I need the live game working *now*" is written down,
  not automated: a rollback is **never server-only** — Railway rollback to the
  `v(N-1)` image **and** `npm dist-tag add terminal-mmo@<N-1> latest` must move
  together, or the equality gate locks everyone out.

## Considered and rejected

- **Backward-compatible protocol negotiation (server supports a version window).**
  Lets client and server deploy independently, but it is real machinery (versioned
  decoders, giving up the safe "no partial decode" invariant) to protect a protocol
  ADR 0009 explicitly allows to churn. The coupling fix is far cheaper.

- **Release on every merge to `main`.** Maximally automated, but mints an npm
  version and redeploys on trivial merges, and — worse — makes protocol cutovers
  (which kick every player) fire at unpredictable times. Tags make the disruptive
  act intentional.

- **`development` + `main` (GitFlow).** Earns its keep on teams with release-
  stabilization windows and parallel release trains; a solo alpha has neither and
  pays in branch upkeep. A tag delivers the "merged vs released" line for free.

- **Per-package independent versions (changesets-style).** We ship one public
  artifact and one coupled server; independent versions are bookkeeping with no
  consumer. One number that stamps client, server, and `/health` makes "are these
  compatible?" the same question as "do the numbers match?".

- **A server-advertised minimum-compatible-client version** (instead of strict
  equality). Would avoid kicking cached clients on non-wire Releases, but the
  minimum is `PROTOCOL_VERSION` reincarnated as a hand-bumped marker. Strict
  equality genuinely *deletes* the concept; its cost (a returning cached client is
  rejected even after a server-only hotfix) is mild given `bunx`-always-`@latest`
  and a World that already wipes on deploy. Documented as the evolution path if
  kick-on-every-Release becomes annoying with real players.

- **Publish first, then deploy.** Burns an immutable npm version with no matching
  server if the deploy then fails — a worse version of the bug that prompted this
  ADR — and keeps the inconsistent window open for the whole deploy.

- **Automated rollback button.** Under strict equality it must coordinate a Railway
  rollback *and* an npm `dist-tag` repoint, and only helps if `v(N-1)` was good —
  conditional machinery roll-forward already covers for a disposable-World alpha.

- **A `@next` pre-release channel.** Maximum pre-`@latest` safety, but the manual
  promotion step is exactly the human-in-the-loop we're removing. Revisit for a
  staging soak once there are real players.

- **Parallel CI jobs up front.** 4× checkout/install overhead to parallelize
  sub-minute checks is a net loss today; revisit when a check gets slow.

## Consequences

- **Wire change:** `hello` drops `protocol: number` and carries a Version string;
  `@mmo/core` loses `PROTOCOL_VERSION`. `packages/server/src/index.ts` and
  `packages/client/src/net/net.ts` swap the integer gate for the string-equality gate;
  the server reads `MMO_VERSION` and skips the gate when it is unset.
- The client must learn its own Version (baked into the bundle at build from the
  tag); the server must learn its own (`MMO_VERSION` env, set by the pipeline at
  deploy). `/health` returns `{ version }` instead of plain `ok`.
- New GitHub Actions: a **CI** workflow (the `ci` script, required on PRs to
  `main`) and a **release** workflow (on `v*` tag: gate → deploy Railway → assert
  `/health` version → `npm publish` via OIDC). Railway auto-deploy-on-push is
  disabled; deploys are triggered by the pipeline.
- New repo secret: a **Railway deploy token** only. npm needs no secret — publishing
  uses Trusted Publishing (OIDC), with `release.yml`'s path registered as the
  `terminal-mmo` package's trusted publisher.
- `bun run ci` gains typecheck + test; `packages/cli/package.json`'s committed
  `version` is no longer authoritative.
- **Future (revisit with active players):** richer pre-production safety than
  roll-forward (staging soak, `@next`, automated rollback), and possibly a
  minimum-compatible-version gate to stop kicking cached clients on non-wire
  Releases. Bugs that pass CI and reach production are out of scope for this layer.
