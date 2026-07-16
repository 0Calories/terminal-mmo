---
status: accepted
---

# @mmo/assets: one asset store, two doors (amends ADR 0030)

Zone and sprite content loaded through two unrelated mechanisms in two places:
`.zone` files were bundle-inlined text imports inside core (`zoneContent.ts`),
while `.sprite` files were an fs-scan in render (`sprite-sources.ts`) with a
near-duplicate scanner in the server (`server/sprites.ts`) just to enumerate
cosmetic ids. This ADR gives asset content one home and one loading story.

## Decisions

- **New package `@mmo/assets`** owns the `sprites/` and `zones/` file trees,
  their discovery, and their identity (ids from filenames, roles from
  directories — the ADR 0031 rules).
- **Split at the parse line, asymmetrically.** Zones leave assets *parsed*:
  assets depends on core for `parseZone` and exports `loadZones(): Zone[]`.
  Sprites leave assets *raw* (`SpriteSource`: id + role + text): compilation to
  art stays in `@mmo/render`, preserving ADR 0030's wall — sprite *code* remains
  unreachable from the server. Core drops `zoneContent.ts` and with it all
  fs/bundler knowledge: core is "given content, simulate."
- **Two subpath doors over one store.** `@mmo/assets/meta` exposes ids/roles/
  zone list only — what the server imports (deleting `server/sprites.ts`);
  `@mmo/assets` exposes the full sources for client/render/forge. Underneath,
  one store with two strategies: fs-scan in dev (so the forge editors' write →
  re-read loop keeps working), embedded map in compiled binaries (the existing
  `MMO_EMBEDDED_SPRITES` mechanism, generalized to zones — both asset kinds
  finally load the same way).
- **No build-time extraction step.** Rejected: total asset payload is ~72KB of
  text; a builder would insert staleness into the forge live-edit loop (ADR
  0031: "the file, not code, is where art lives") and buy nothing the `/meta`
  interface split doesn't already guarantee. If payload ever matters, the
  embedded-build step can emit per-target payloads behind the same two subpaths.

## Amendment to ADR 0030

"Art is physically client+forge-side" weakens to: art *code* (compilation,
registries, drawing) is client+forge-side; art *data* is inert text in a
package the server may depend on through `/meta`. The server already required
sprite ids from those same files; this makes that dependency honest instead of
duplicated.
