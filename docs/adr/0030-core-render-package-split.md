---
status: accepted
---

# Split @mmo/shared into @mmo/core and @mmo/render

`@mmo/shared` held everything: the deterministic simulation (types, combat, physics,
zone, pose selection, sprite metadata) AND presentation (the sprite art grids and
`render.ts` drawing). The server never draws, yet could import a renderer from the
same barrel — the sim/presentation boundary was convention only.

We split it in two:

- **@mmo/core** — the deterministic simulation/domain heart: types, combat, physics,
  zone, pose selection, and sprite *metadata* (registry indices, the default palette
  key / tint that authoritative combat reads, baseline). Depended on by **server +
  client + forge**.
- **@mmo/render** — presentation: the sprite *art* grids and `render.ts` drawing.
  Depends on `@mmo/core`; depended on by **client + forge**, never the server.

The server's `package.json` does not list `@mmo/render`, so a stray
`import … from '@mmo/render'` in server code fails to resolve — the boundary is
enforced by the build graph, not a convention. A dependency-cruiser CI rule
("`packages/server` may not depend on `@mmo/render`") backstops it against someone
adding the dependency by hand.

## Why a package split, not a subpath export + lint rule

Presentation must be *provably unreachable* from the server: the sim is deterministic
and must never carry a rendering dependency. A package boundary is the only mechanism
where the mistake cannot compile — lint rules can be disabled and subpath imports
still resolve.

## Why "core", not keep "shared"

Once presentation is *also* shared (client + forge), "shared" stops discriminating —
both packages are shared. "core" names what it *is*: the sim the server runs. It pairs
with "render" so the two names document the boundary.

## Sprite seam

Sprite *art* moves to `@mmo/render`, but sprite *identity* stays in `@mmo/core` — the
server needs the crumb of sprite metadata that authoritative combat reads (the
death-tint's default palette key, `entityTint`), never the art. This refines the
visual architecture of ADR 0003 / ADR 0020 (art is physically client+forge-side; only
pose *selection* and metadata remain shared with the server).

## Not a wire change

This is a pure package boundary + rename; it does not touch the wire or behavior.
Zone files stay top-level content loaded via `@mmo/core` by all three of server (to
simulate), forge (to author), and client (to render terrain locally) — they are not
presentation and do not move into `@mmo/render`.
