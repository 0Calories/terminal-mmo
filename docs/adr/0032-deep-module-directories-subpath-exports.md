---
status: accepted
---

# Deep-module directories enforced by subpath exports; core's root barrel removed

The re-architecture that split `@mmo/core`/`@mmo/render` (ADR 0030) left module
boundaries *inside* each package as convention only: `core/src/index.ts` was an
`export *` barrel over all 27 source files, so every internal symbol was public
API and every module's real interface was the whole `Entity` bag. This ADR is
the second pass: modules become deep, and their boundaries become mechanical.

## Decisions

- **A module is a directory with a curated barrel, not a package.** New
  packages are reserved for boundaries that must be *provably unreachable* in
  the build graph (ADR 0030's bar); topic boundaries within a package are
  directories: `core/src/{entities,physics,combat,zones,world,protocol,…}`.
  The one new package is `@mmo/assets` (ADR 0033).
- **Enforcement is `package.json` subpath `exports`.** Each module's barrel is
  declared as an export (`"./physics": "./src/physics/index.ts"`); anything not
  listed fails to compile and fails to resolve. The module's barrel *is* its
  public interface — internals are genuinely private, not privately named.
- **The core root barrel is removed.** Consumers import subpaths only
  (`@mmo/core/physics`, `@mmo/core/entities`). Every import statement documents
  which module it depends on, and the consumer→module graph is greppable. A
  curated root re-exporting "common" types was rejected: two doors to the same
  symbol, and the root barrel is exactly where accidental-public API re-accretes.
- **Modules stop accepting the `Entity` bag; they declare narrow views.**
  `Entity` stays one flat record (wire- and churn-friendly), but each module's
  functions type against the structural slice it owns — physics defines
  `MomentumBody` and a `Drive`; combat defines `Combatant`. Signatures like
  `stepEntity(body: MomentumBody, drive: Drive)` state truthfully what a module
  can see and touch. A structural regroup (`e.body.x`) was rejected for now: it
  churns the protocol/interp/predict layers for a mostly aesthetic gain, and
  remains possible later behind these same signatures. Per-kind factories in
  `entities/` are the one place required-vs-absent fields are decided.
- **`constants.ts` dissolves into its owning modules** (`COMBAT` → combat,
  monster tuning → entity archetype profiles); a hub constants file with fan-in
  15 was the god-type pattern in miniature.

## Consequences

- One-time mechanical churn across ~45 importing files in client/forge/render/
  server; import blocks get longer and honest (a file using physics + combat +
  entities now shows three module imports).
- The views restrict *functions*, not data: at runtime the flat record is still
  there, and the fence is the compiler plus review. If a real bug ever traces to
  cross-module field writes, the structural regroup is the recorded next step.
