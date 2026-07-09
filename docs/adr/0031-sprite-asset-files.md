---
status: accepted
---

# Sprite asset files (`.sprite`) and the forge Sprite editor

Sprite art was hand-authored TypeScript — half-block template literals in
`sprites/*.ts`, registered in hand-maintained arrays, referenced by numeric
index from the wire and the Save. Making art meant mentally XOR-ing quadrant
glyphs in a code editor and touching code for every new hat. We decided sprites
become **`.sprite` asset files** — runtime-parsed, forge-authored, and the sole
place art exists — and forge grows a pixel-first **Sprite editor**
(`forge sprite edit|render|preview|check`). Vocabulary: CONTEXT.md
"Sprite authoring".

## The decisions and why

**Runtime-parsed files, not codegen.** The file is the source of truth, exactly
like `.zone`: dev reads `sprites/**` from disk; the published bunx bundle embeds
the sources at build time (`packages/cli/build.ts`) behind one
`loadSpriteSources()` seam. Codegen was rejected: it adds a build step and a
stale-artifact failure mode for zero runtime benefit at this scale.

**One format for every sprite shape.** A `.sprite` file is fundamentally *named
frame grids + named anchors + metadata*. A hat is the degenerate single-frame
case; a Form or Weapon is a richer *validation profile* of the same grammar, not
a separate filetype. Per-shape formats were rejected — the shapes were already
~80% identical, and a new consumer (animated Monsters) becomes a new profile,
not a new parser.

**Zone-style grammar: JSON header + visible art sections.** Header carries
anchors, baseline, frame lists, optional per-pose `fps`, and file-local colors;
each frame is a named section of glyph art you can literally see in a text
editor, with optional `@colors`/`@bg` grids. Pure JSON (frames as string
arrays) was rejected: unreadable art, ugly diffs, and it breaks the project's
inspectable-artifact design language.

**File owns frames + one timing knob; selection logic stays code.** The pose
ladder, distance-driven walk cycle, and phase-progress sampling remain shared
pure functions (ADR 0020's determinism). The file adds only an optional
per-pose `fps` (default `EMOTE_FPS`) — the one timing knob an artist owns.
Full clip/timeline descriptions were rejected as a rig by the back door.

**Open anchor names, per-frame overrides.** Files declare any named anchor
(`grip`, `head`, later `back`…); role profiles require specific ones. Frames
may override an anchor so a raised arm carries the weapon. The old fixed
per-body anchor quietly forbade poses that move the hand/head — the normal case
in expressive art.

**String ids everywhere; identity is the filename.** `cosmetics.form`/`hat` and
the weapon's replicated appearance become sprite ids (directory = role, id =
filename, per ADR 0011's zone precedent) in the Save, on the wire, and in the
creator. Index registries were rejected because file-defined sets make
positional indices a landmine: adding `apple-hat.sprite` before `cap.sprite`
would silently re-hat every Save. A pinned index manifest was rejected as a
hand-maintained list. One-time load migration maps existing numeric Saves
through the frozen current arrays.

**Scan vs reference, by what the thing is.** Cosmetic roles (forms, hats)
register by directory scan — the file existing is what makes it pickable.
Combat entities (weapons, monsters) keep their stats in code/catalogs and gain
a `sprite: "<id>"` reference — art files must never own game balance. Emotes
stay a code registry (they carry lifetime semantics); a Form's `emote:*` poses
are validated against it. `forge sprite check` enforces all joins in CI.

**fg+bg per cell — a renderer-model change.** A cell may be one color +
transparency (the old model) or two colors fully opaque; never both, and never
three. This doubles color resolution (buddy's 18×6 pixels were previously
constrained to 9×3 color regions) at the cost of a second color channel through
`Sprite`, the blit path (hurt/ghost/recolor apply to both), and the format.

**Quadrant pixels (2×2), blocked-at-paint-time.** The editor's canvas is
quadrant sub-pixels compiled to block glyphs (a lossless bijection given cell
colors), with a secondary glyph-stamp Tool for `▲`/`╱`-class cells. Sextants
(2×3) were rejected for spotty terminal-font coverage — tofu Avatars in a
bunx-anywhere game; Braille (2×4) renders airy, not solid. Painting an
inexpressible cell is *refused with feedback* rather than quantized at export —
export-time merging rebuilds the exact disappointment loop (draw ≠ ship) this
tool exists to kill, per the Zone editor's "unrepresentable, not merely
validated" principle.

**Full migration, parity-gated.** Every TS sprite (forms, hats, weapons,
monsters, NPC/signpost) ports to files and the TS modules are deleted, gated by
golden renders diffing each ported sprite against its TS original through the
shared renderer. Coexistence was rejected: two authoring systems, and the
editor couldn't touch the art most needing iteration.

## Consequences

- The wire and Save formats change (numeric cosmetic/weapon indices → string
  ids); needs the one-time Save migration. On the wire the id ships as an
  APPENDED trailing field (the legacy index byte stays in place, best-effort),
  gated by ADR 0012's release Version check — never a hand-bumped protocol
  integer, per CONTRIBUTING's wire rules.
- `@mmo/render` (ADR 0030) owns the parser and art; `@mmo/core` sees only
  sprite ids and the metadata crumbs authoritative combat reads. The server
  reads `sprites/` ids from disk for validation, never the art.
- Dropping a file into `sprites/hats/` **is** the release process for a
  cosmetic; there is deliberately no code-side hat/form list to update.
- `forge sprite rename` was deliberately skipped: references now live in code
  and Saves, so renames stay manual-and-rare rather than auto-rewritten.
