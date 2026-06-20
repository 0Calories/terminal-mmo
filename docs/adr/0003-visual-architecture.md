---
status: accepted
---

# Visual architecture: rich ASCII sprites, decoupled from logical entities

Avatars (and Monsters/NPCs) are rendered as expressive multi-row ASCII-art
figures (~5 rows × ~7 cols, "Claude-mascot" level of detail), not single glyphs.
This is a deliberate bet that looking cool is core to the project, and it forces a
set of decisions about how rich visuals coexist with a crowded, pass-through,
real-time world.

## Decisions

- **Hard-decouple the logical entity from the visual sprite.** Each entity has a
  small logical footprint (collision/hitbox, ~1×2) that is the *only* thing the
  simulation and netcode know about (position + box). The multi-row ASCII
  **Sprite** is purely decorative, client-side, and anchored to that box. The
  collision box is intentionally unrelated to the art's size.
- **Overlap is allowed; legibility comes from z-ordering.** Avatars pass through
  each other (ADR 0001), so their sprites will overlap in crowds. We do not
  prevent this. Draw order is by y-position, with the local Player's own Avatar
  always on top; overlapped others may be dimmed/ghosted.
- **Sprite size sets world scale.** ~5×7 is the budget; platform spacing, jump
  height, and Zone dimensions are all designed in "avatar" units. The playfield
  is effectively lower-resolution and crowds are denser as a result.
- **MVP animation = a small fixed pose set** (idle / walk / jump / attack) ×
  facing (mirror left/right), hand-authored, expandable later.
- **Combat telegraphs render above all sprites** as high-contrast glyphs
  (projectiles, hit-flashes) so fights stay readable amid dense art.
- **Customization = region-recolor + hat-anchor + nameplate.** ANSI color zones
  on the art, a cosmetic accessory overlay anchored to a defined "head" cell, and
  a colored nameplate. Start with ONE well-made character template plus many
  color/cosmetic options (templates are the expensive axis to author).

## Considered and rejected

- **Single glyph (`@`)** — cheapest and readable, rejected as too plain for a
  project whose appeal is visual coolness.
- **2-cell sprite** — insufficient expressiveness per the author.
- **Coupling collision/hitbox to the art's full size** — rejected: it would force
  avatar-avatar collision (contradicting ADR 0001) or messy physics, and make
  netcode sync large footprints.

## Consequences

- Effective playfield resolution is low and towns are visually dense; level design
  must account for ~5-row figures.
- Authoring cost concentrates in character templates and pose frames; mitigated by
  shipping one template + many recolors first.
- Performance risk (many multi-row sprites moving at once) is the primary thing the
  OpenTUI spike (ADR 0002) must validate, alongside camera/scroll comfort.
