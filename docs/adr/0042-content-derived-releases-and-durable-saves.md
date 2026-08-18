---
status: accepted
---

# Content-derived releases: contract-hash compatibility, selective shipping, durable saves

> Vocabulary: [`CONTEXT.md`](../../CONTEXT.md) — World, Handle, Version, Release.
> Amends [ADR 0009](./0009-live-hosting-and-bunx-delivery.md) and
> [ADR 0012](./0012-release-versioning-and-cicd.md): replaces the Version-equality
> compatibility gate with a content-derived contract hash, replaces atomic
> ship-everything Releases with selective shipping, and retires the
> "World wipes on deploy" assumption.

The v0.8.0 Release shipped a silent production outage: portals did nothing.
The pipeline's health gate asserted a Version that came from an **env var staged
before the deploy**, not from running code — so when Railway's watch paths
skipped the build, a forced restart of the old v0.7.0 image "passed" the gate as
0.8.0 and the new client published against a server with old zone geometry. The
Version-equality gate (ADR 0012) was a *proxy* for "built from the same inputs,"
and the proxy detached from the inputs. Separately, the pipeline's own comments
documented the races it papered over (detach-then-redeploy, retry loops,
skipped-build hangs), every Release restarted the server and kicked every
connected player even when nothing server-side changed, and player saves —
durable in intent since SSH-key auth + `bun:sqlite` persistence shipped — were
silently wiped on every deploy because the SQLite file lived on the container's
ephemeral filesystem.

This ADR records the redesign: compatibility becomes a property of **content**,
checked mechanically at every layer; Releases ship **only the artifacts a change
actually affects**; and player saves **survive Releases**.

## Decisions

### Compatibility

- **The compatibility gate is a contract hash, not Version equality.** The
  **release contract** is the set of inputs client and server must agree on:
  the shared deterministic sim and wire protocol (`@mmo/core` sources), zone
  data, and the sprite metadata the server consumes (the cosmetic id sets — not
  sprite art, which is a client-only render concern). Both sides compute a
  deterministic hash over that content; `hello` carries the client's hash and
  the server rejects on mismatch with the existing "run `bunx
  terminal-mmo@latest`" message. Version becomes a human-facing label (npm
  version, `/health`, Release names) and stops gating anything. This *deletes*
  the v0.8.0 failure class rather than detecting it: the gate compares actual
  content on both ends at every handshake, not a pipeline promise at release
  time — a geometry mismatch rejects loudly instead of silently eating
  interacts.

- **The contract boundary is a committed, CI-enforced manifest.** One module in
  `@mmo/core` classifies every repo path as `contract`, `server-only`,
  `client-only`, or `neither` (docs, CI). The hash computation, the pipeline's
  what-changed logic, and CI all import this single definition. CI fails on any
  tracked file the manifest cannot classify, forcing the classification decision
  at PR time. The boundary errs fail-safe: anything ambiguous belongs in the
  contract, which over-triggers a dual ship but can never reintroduce silent
  drift. (Corollary, accepted: a comment edit in `@mmo/core` still forces a full
  dual Release.)

- **One gate, every environment; the dev sentinel dies.** The contract hash is
  computed from loaded content, so the same equality check runs identically in
  production, the dev environment, and localhost — a local client and server
  from one checkout always match. The ADR 0012 rule "skip the gate when
  `MMO_VERSION` is unset" is deleted; there is no environment-conditional gate
  behavior left to get wrong.

### Identity

- **Every shipped artifact carries a build stamp proving its origin.** A
  committed stamp script derives `build-info.json` — `{ version, gitSha,
  contractHash }` — from the checkout. The release pipeline runs it before
  shipping anything; `railway up` carries the file into the image and the client
  build bakes it into the bundle. The `MMO_VERSION` Railway variable is deleted.
  `/health` reports the running process's stamp with the contract hash
  **recomputed from the assets the server actually loaded** — health describes
  what is live, never what was configured.

- **Two boot guards keep identity honest.** The server refuses to boot when
  `RAILWAY_ENVIRONMENT` is set but no stamp is present (a manual `railway up`
  can never deploy an anonymous server; the break-glass procedure is "run the
  stamp script, then `railway up`"). It also refuses to boot when the stamped
  contract hash disagrees with the hash recomputed from loaded content — fail at
  deploy, where the health gate catches it, never at a player's interact.

### Shipping

- **Releases ship selectively; the shape is computed, not chosen.** The pipeline
  diffs the Release against the previous one and classifies the changed paths
  through the manifest: contract-touching changes ship **both** artifacts;
  server-only changes deploy the server and publish nothing; client-only changes
  publish the client and **do not restart the server** (nobody is kicked for an
  art tweak); doc-only Releases are no-ops. A server redeploy kicks every
  connected player, so "don't needlessly redeploy" is a player-experience
  requirement, not an optimization. Published npm versions may skip numbers
  (a server-only Release burns no client version); the stamp's `gitSha` and
  `contractHash` are the real identity. A manual "ship everything" workflow
  input is the escape hatch for the day the diff is distrusted.

- **The gate matches the shape.** Server-shipping Releases assert
  `/health.gitSha` equals the released commit before the irreversible npm
  publish. Client-only Releases deploy nothing and instead assert the **running**
  server's `/health.contractHash` equals the hash baked into the
  about-to-publish client — the pipeline reads live state rather than
  manufacturing it with a forced restart. Deploy-first/publish-last (ADR 0012)
  is retained: its invariant — never burn an irreversible npm version on a
  failed deploy — is unchanged, now enforced by a gate that cannot be satisfied
  by a stale image.

- **The deploy scaffolding is deleted.** Railway watch paths are cleared
  (deploys are exclusively explicit `railway up` from the pipeline, so
  skip-on-unchanged-paths is pure downside); with builds guaranteed, `railway up
  --ci` streams the build and fails fast, and the `--detach` + forced-redeploy +
  retry-loop + env-var health gate machinery in the release workflow is removed
  wholesale.

### Players and data

- **Player saves survive Releases.** The SQLite store moves onto a mounted
  Railway volume (`MMO_DB_PATH`). The ADR 0009/0012 assumption "the World wipes
  on deploy anyway" is retired; the contract is: *a Release restarts the process
  and drops sessions, but never destroys player state.* Save schema policy, now
  that saves outlive code: the save is a JSON blob; changes are additive, absent
  fields are tolerated, and a field's meaning is never repurposed. On boot the
  server snapshots the database file to a timestamped copy on the volume (keep
  the last few) before opening it — the restore point for a data-corrupting
  Release.

- **Shutdown drains gracefully.** On SIGTERM the server broadcasts an in-game
  "server is restarting for an update" notice, waits a short grace period,
  flushes saves, and closes sessions with the upgrade message — a Release reads
  as an announced restart, not a dead socket. Strict rejection of incompatible
  clients stays; the drain changes tone, not policy.

- **Recovery is roll-forward first, with a paired break-glass.** Roll-forward is
  *stronger* than under ADR 0012 once the dev environment exists (hotfixes are
  QA-able live before shipping). The documented, never-automated break-glass: if
  the bad Release changed the contract, the Railway rollback and `npm dist-tag
  add terminal-mmo@<prev> latest` must move together — a half-rollback fails the
  contract gate loudly, not silently. If the contract didn't change, either side
  rolls back alone; `/health.contractHash` says which case applies. Rollback
  never touches the volume; bad *data* is recovered from the boot snapshot,
  accepting the loss of the window since boot.

### Phase 2 — release UX (after phase 1 has cut at least one real Release)

- **A `develop` branch feeds a persistent dev environment.** Railway's
  environments feature runs a second server (own domain, own volume) deployed on
  every push to `develop`, access-gated by an SSH public-key allowlist — the
  auth the game already has, no new machinery. QA is playing the dev server with
  a dev client pointed at it. ADR 0012's rejection of a development branch is
  **overturned with cause**: it was rejected as GitFlow bookkeeping with no
  consumer; here the branch is the substrate for a staging server, and
  AI-velocity development raised the error rate that staging absorbs.

- **Merging `develop` into `main` cuts the Release.** The merge is the manual-QA
  sign-off, preserving the QA-before-release rule structurally. Guardrails, all
  enforced by config rather than discipline: the release merge is a merge commit
  or fast-forward, never a squash (squashing diverges the branch histories and
  corrupts the what-changed diff); the version auto-bumps minor (patch/major via
  PR label); `hotfix/*` branches may PR directly to `main` and are back-merged
  to `develop` automatically; branch protection admits nothing else to `main`.

## Considered and rejected

- **A minimum-compatible-version window** (re-rejected from ADR 0012). The
  contract hash achieves the same player-facing outcome — no kicks on
  compatible Releases — without a hand-bumped marker: the "window" is computed
  from content, which is exactly what the window was always trying to
  approximate.

- **Keeping atomic ship-everything Releases.** Simplest possible pipeline, but
  it forces a full server restart — kicking every player — on every art tweak,
  and republishes unchanged clients. The cost moved from CI minutes to player
  experience; not worth the simplicity.

- **Per-artifact release tags (`server-v*` / `client-v*`).** Explicit control,
  but the human re-derives what the manifest already knows, and a wrong choice
  recreates drift — the exact failure this ADR exists to delete.

- **AST-level or built-output hashing to reduce over-triggering.** Cleverness at
  the load-bearing correctness element. File-content hashing over-triggers
  toward the safe side; accepted.

- **Deriving `gitSha` inside the Docker build.** `railway up` does not ship
  `.git`, and the client bundle needs the same stamp anyway; a pre-upload stamp
  script serves both artifacts from one derivation.

- **Server serves zones to clients at connect** (structural elimination of the
  dual zone copy). Truly removes the class, but it is a real protocol and asset
  pipeline project, and under a content-compared handshake it buys elegance,
  not safety. Documented as the evolution path.

- **Semantic-release-style commit-message versioning.** Machinery sized for
  teams; one developer needs one default (auto-minor) and one override.

- **Automated rollback.** Still conditional machinery (only helps if the
  previous pair was good), and now also data-adjacent. The paired manual
  break-glass is documented instead.

## Consequences

- **Wire change:** `hello` carries the client's contract hash; the server gates
  on hash equality and drops the Version-equality gate. Reject copy keeps the
  Version string for the human-readable message.
- `@mmo/core` gains the release-contract module: path classification,
  contract-hash computation, release-shape computation. `bun run ci` gains the
  manifest exhaustiveness check.
- A committed stamp script produces `build-info.json` (gitignored); the server
  reads it at boot and enforces both guards; the client build bakes it; `/health`
  returns `{ version, gitSha, contractHash }`. `MMO_VERSION` is deleted from
  Railway, the server env, and the client build env.
- The release workflow is rewritten around the computed release shape; the
  detach/redeploy/retry machinery is deleted. Operator (dashboard) steps:
  watch paths cleared (done), volume mounted, `MMO_DB_PATH` set.
- The player store gains boot-time snapshot-with-retention; shutdown gains the
  drain (notice → grace → flush → close).
- ADR 0009's "ephemeral alpha, wipes on deploy" and ADR 0012's Version-equality
  gate, atomic Release unit, and develop-branch rejection are superseded as
  described; deploy-first/publish-last, tag-triggered releases (until phase 2),
  strict rejection, OIDC publishing, and roll-forward recovery carry forward.
- **Phase 2** lands as its own implementation effort once phase 1 has shipped a
  real Release: Railway `dev` environment + key allowlist, branch protections,
  merge-triggered release workflow with auto-versioning and hotfix back-merge.
