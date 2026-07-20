---
status: accepted
---

# Sprite format v2: an ordered animation array with unnamed, index-bound frames

Post-#351 feedback hit the seams of the v1 `.sprite` header. Strip order in the
editor is a faithful mirror of the animation map (ADR 0035), but the map's
order was *derived* — explicit header animations first, then implicit
single-frame animations appended in section order — so buddy's `idle`, the
badged Default frame and literally the first grid in the file, rendered fourth.
Frame names (`walk-0`, `wave-1`) were pure plumbing: the header referenced
them, anchors keyed off them, yet every semantic lives in array *position*
(walk is distance-indexed, swing phase-indexed). Naming each frame bought
nothing and leaked into every UI label.

## Decisions

1. **The header's `animations` is an ordered array of animation objects —
   `{ "name", "fps"?, "anchors"? }` — and that array is the single source of
   animation order and metadata.** It replaces the v1 animation map, the
   top-level `fps` map, and the top-level `frames` override map (per-frame
   anchor overrides move into the owning animation object, keyed by frame
   index). The array is exhaustive: a grid section referencing an undeclared
   animation is a parse error, as is a declared animation with no sections —
   the "sections define animations" alternative was rejected because a section
   typo would silently mint a new animation. The editor's strips view stays a
   pure mirror (no editor sorting, reaffirming ADR 0035): order now lives
   explicitly in the data.

2. **Frames are unnamed.** A grid section binds by `--- <animation> <index>`;
   a single-frame animation omits the index (`--- jump`). Frame count is
   derived from the sections — never declared — and indices must be contiguous
   from 0. The v1 "implicit single-frame animation" concept dissolves: every
   section belongs to an animation, and a bare `--- jump` *is* the single frame
   of the declared animation `jump`. UI surfaces label frames `frame 0`,
   `frame 1`, … within their animation; only the animation is named.

3. **The Default frame is frame 0 of the array's first animation.** Same badge
   (`◈`), same file-level anchor ownership and override semantics (ADR 0036) —
   only the definition moves from "first grid section" to the header array,
   which is now the authority on order. Grid-section order is presentational;
   the serializer emits sections in header order.

4. **`sprites:check` warns — never errors — when a form's first animation is
   not `idle`.** With Default defined positionally, "keep idle first" is a
   file-authoring convention again; the warning keeps the next sprite from
   silently regressing the way buddy did. Weapons already *error* when the
   first frame belongs to `swing` (ADR 0036); that check stands.

5. **Hard cutover, no dual-format reading.** The parser reads only v2; every
   `.sprite` file migrates in the same commit via a one-time script (11 files
   today, only two of which even declare animations). The serializer keeps ADR
   0036's compact-header discipline: one line per animation object, so saves
   stay diff-reviewable.

## Consequences

- Amends ADR 0035 (animation map → ordered array; the migration-emitted
  "idle-first" convention gains a check warning) and ADR 0036 (Default frame
  restated positionally; serializer compactness extends to animation objects).
- Frame names leave the format, the parser types, and every editor label
  (strip rows, focus tabs, status row read `frame N`). Any snapshot keyed by
  frame name regenerates as a deliberate, reviewed step of the migration
  commit.
- CONTEXT.md: **Sprite file**, **Animation**, **Frame**, and **Default frame**
  entries rewritten; "implicit single-frame Animation" vocabulary retires.
- Cosmetic roles (hats, monsters) gain a one-line header entry naming their
  single animation — the price of an exhaustive array, paid once by the
  migration script.
