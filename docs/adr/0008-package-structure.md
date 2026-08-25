---
status: accepted
---

# Package structure: core/render/assets split, deep modules behind subpath exports

## Decisions

- **`@mmo/core` is the deterministic sim; `@mmo/render` is presentation.** The
  server depends on core, never render — enforced by the build graph (the
  dependency isn't declared, so the import cannot compile) and backstopped by
  a dependency-cruiser CI rule. A package boundary, not a lint rule, because
  presentation must be *provably unreachable* from the deterministic sim.
  Sprite *identity/metadata* stays in core (the crumbs authoritative combat
  reads); sprite *art and compilation* live in render. `@mmo/assets` holds
  the content files (ADR 0007).
- **Within a package, a module is a directory with a curated barrel, enforced
  by `package.json` subpath exports** (`@mmo/core/physics`, …). Anything not
  exported fails to resolve — internals are genuinely private. Core's root
  barrel is removed: every import names the module it depends on, and the
  consumer→module graph is greppable. New packages are reserved for
  boundaries that must be unreachable; topic boundaries are directories.
- **Modules declare narrow views, not the `Entity` bag.** `Entity` stays one
  flat record (wire- and churn-friendly), but each module types against the
  slice it owns (physics sees a `MomentumBody` + `Drive`; combat a
  `Combatant`). Hub constants files are dissolved into their owning modules.
- **Test at the highest deterministic seam that owns the behavior**; run
  interactive TUI checks in a real terminal, headless checks via
  `@opentui/core/testing`. `bun run ci` is the single gate, identical locally
  and in CI.
