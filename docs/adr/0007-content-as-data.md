---
status: accepted
---

# Content is data: `.zone` and `.sprite` files, authored in forge

Zones and sprite art were once TypeScript; humans and agents couldn't design
or preview a room or a sprite without writing imperative code. All content
moved to inspectable text files parsed at runtime, with forge TUI editors.

## Decisions

- **Zones are `.zone` files: a JSON header + `---` + an ASCII grid**, parsed
  by a pure string→Zone function in `@mmo/core` (disk IO stays at the edges).
  The grid holds position (`#` wall, `=` one-way platform — authored per
  tile, since a wall and a ledge must differ horizontally and no geometric
  heuristic can classify mixed structures); the header maps glyphs to catalog
  ids. Entities are **by reference** into separately-authored catalogs — a
  Zone is pure placement. **A Zone's id is its filename**; no header field to
  drift from the path.
- **Sprites are `.sprite` files: a JSON header + visible glyph-art sections.**
  One format for every role (form, hat, weapon, shield, monster — the
  directory names the role and picks a validation profile). The header's
  `animations` is an ordered array; frames are unnamed and index-bound; the
  **Default frame** (frame 0 of the first animation) owns file-level anchors,
  with per-frame overrides. Anchors are offsets (negatives legal). String
  ids everywhere — identity is the filename; positional index registries were
  rejected because inserting a file would silently re-skin every Save.
  Dropping a file into `sprites/hats/` *is* the release process for a
  cosmetic. Timing authority stays in code/combat data: phase-bound
  animations sample by phase progress, never fps, so more frames smooth a
  telegraph but can never change its duration.
- **`@mmo/assets` is the one asset store with two doors**: `/meta` exposes
  ids/roles only (what the server imports); the root exposes full sources for
  client/render/forge. Zones leave parsed; sprites leave raw (compilation
  stays in `@mmo/render`, keeping sprite code unreachable from the server).
  fs-scan in dev, embedded map in published builds — one seam.
- **Editors are entity-centric and mouse-primary, operating on the lossless
  document.** The Zone editor places Placeables and owns the glyph map
  (orphan glyphs are unrepresentable, not merely validated). The Sprite
  editor paints quadrant sub-cell Pixels compiled to half-block glyphs,
  WYSIWYG through the shared renderer, with a glyph-stamp tool for what
  pixels can't express. `forge … check` enforces every cross-file join in CI.
