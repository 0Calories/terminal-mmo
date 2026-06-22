---
status: accepted
---

# The Zone editor is entity-centric: it owns the glyph↔Placeable mapping

> Vocabulary: [`CONTEXT.md`](../../CONTEXT.md) — Zone editor, Placeable, Palette,
> Tool, Terrain, Monster, NPC, Portal. Builds on
> [ADR 0008 (Zones as data)](./0008-data-driven-zones.md). Draft editor:
> [#87](https://github.com/0Calories/terminal-mmo/pull/87) (closes #84).

The draft `zone edit` (#87) is **glyph-centric**: the author thinks in single
chars. You hand-author the header's glyph map (`"c": "chaser"`) as text first,
then the editor only *stamps already-declared glyphs* into the grid. The whole
orphan-key machinery (declared-but-unused, used-but-undeclared glyphs) exists to
*validate against* the states this model makes easy to reach.

This ADR records the decision to make the full editor **entity-centric**. The
author works in [Placeables](../../CONTEXT.md) — a Terrain type, a catalog
[Monster](../../CONTEXT.md)/[NPC](../../CONTEXT.md), or a Structure (Portal) — and
the editor **owns the glyph↔Placeable mapping in the header**: it allocates a
glyph the first time a Placeable type is used, reuses it for further instances,
and garbage-collects the header entry when the last instance is erased.

## Decisions

- **Authors place Placeables, never glyphs.** The [Palette](../../CONTEXT.md) is
  generated from `catalogs.json` plus the structural primitives — the editor
  consumes the catalog and never edits it (a separate creature/NPC-authoring tool
  will own that later).
- **The editor owns the glyph map.** Glyph assignment, reuse, and removal are an
  internal serialization detail the author never sees. Orphan glyphs and
  undeclared glyphs become **unrepresentable**, not merely validated — the same
  spirit as ADR 0008's by-reference entity model.
- **Still operates on the lossless document, not a parsed `Zone`.** `parseZone`
  is lossy (#84/#87); every edit mutates the raw `EditorDoc` (verbatim header +
  raw rows) and re-renders through the shared renderer. The entity-centric layer
  sits *on top of* the document model — it synthesizes header entries, it does
  not round-trip through `Zone`.

## Consequences

- A glyph-allocation strategy is needed (one glyph per catalog type for
  Monsters/NPCs — repetition in the grid = multiple instances; one glyph per
  distinct config for data-carrying Placeables like Portals).
- Data-carrying Placeables (Portals: `{ target, arrival }`) need a placement form,
  not a bare stamp — see #87's follow-up and the editor design.
- The orphan-key validator stays as a CI backstop for hand-edited files, but the
  editor itself can no longer *produce* those states.
